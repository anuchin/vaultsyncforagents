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
var LOCAL_INDEX_SCHEMA_VERSION = 1;
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
  if (version !== LOCAL_INDEX_SCHEMA_VERSION) {
    throw new ProtocolError(
      `Local index schema version ${version} is not supported by this build (expected ${LOCAL_INDEX_SCHEMA_VERSION}); a migration is required`
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
  const { hash, size, versionId, clock, deletedAt, isFolder } = raw;
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
  const entry = {
    hash,
    size,
    versionId,
    clock: { counter: clock.counter, deviceId: clock.deviceId }
  };
  if (deletedAt !== void 0) entry.deletedAt = deletedAt;
  if (isFolder !== void 0) entry.isFolder = isFolder;
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
async function scanVault(storage, index, settings, now) {
  const files = await storage.listFiles();
  const kept = [];
  for (const file of files) {
    if (!isIgnored(file.path, settings)) kept.push(file);
  }
  const keptPaths = new Set(kept.map((f) => f.path));
  const added = [];
  const modified = [];
  for (const file of kept) {
    const entry = index[file.path];
    const hash = await sha256Hex(await storage.readFile(file.path));
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
    emptyFolders
  };
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
      const staged = await this.stagePushes(plan);
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
  async stagePushes(plan) {
    var _a;
    const copySources = /* @__PURE__ */ new Map();
    for (const conflict of plan.conflicts) {
      if (conflict.conflictCopyPath !== void 0) {
        copySources.set(conflict.conflictCopyPath, conflict.path);
      }
    }
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
      }
      staged.push({ ...this.toStaged(push), bytes });
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
      ...commit.isFolder === true ? { isFolder: true } : {}
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
    this.doFetch = (_a = options.fetchImpl) != null ? _a : fetch;
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
    return (_a = this.overrides.fetchImpl) != null ? _a : fetch;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC50cyIsICJzcmMvYmxvYnN0b3JlLnRzIiwgInNyYy9kYXRhLnRzIiwgInNyYy93b3JrZXJhcGkudHMiLCAic3JjL3BhaXJpbmcudHMiLCAic3JjL3Byb3RvY29sLWhhbmRsZXIudHMiLCAic3JjL3JlY29ubmVjdC50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAic3JjL3N0YXR1c2Jhci50cyIsICJzcmMvdHJhbnNwb3J0LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIFBsdWdpbiBlbnRyeSBwb2ludCBcdTIwMTQgT2JzaWRpYW4gbG9hZHMgYG1haW4uanNgIGFuZCBpbnN0YW50aWF0ZXMgdGhlIGRlZmF1bHRcbiAqIGV4cG9ydC4gRXZlcnl0aGluZyByZWFsIGxpdmVzIGluIGBwbHVnaW4udHNgIChhbmQgaXRzIG1vZHVsZXMpOyB0aGlzIGZpbGVcbiAqIG9ubHkgcmUtZXhwb3J0cy5cbiAqL1xuXG5leHBvcnQgeyBWYXVsdFN5bmNQbHVnaW4gYXMgZGVmYXVsdCB9IGZyb20gJy4vcGx1Z2luLmpzJztcbiIsICIvKipcbiAqIGBWYXVsdFN5bmNQbHVnaW5gIFx1MjAxNCB0aGUgT2JzaWRpYW4gY2xpZW50IChkZXNrdG9wICsgbW9iaWxlKS5cbiAqXG4gKiBvbmxvYWQ6IGxvYWQgbGluayBpZGVudGl0eSBcdTIxOTIgaWYgbGlua2VkLCBidWlsZCBgU3luY0NsaWVudGAgKGNvcmUpIG92ZXIgdGhlXG4gKiBPYnNpZGlhbiBhZGFwdGVycyBhbmQgcnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKHRoZSBzeW5jLW9uLW9wZW5cbiAqIGNvbnRyYWN0LCBGUi00L0ZSLTUvRlItMTIpLCB0aGVuIGVudGVyIGxpdmUgbW9kZSAodmF1bHQgZXZlbnRzICsgcGVyaW9kaWNcbiAqIHJlc2NhbiArIGZvY3VzIHJlc2Nhbikgd2l0aCBhIHN0YXR1cy1iYXIgaW5kaWNhdG9yIGFuZCBqaXR0ZXJlZFxuICogZXhwb25lbnRpYWwtYmFja29mZiByZWNvbm5lY3QgKGNhcHBlZCBhdCA2MCBzKS5cbiAqXG4gKiBBIDEgSHogXCJzdXBlcnZpc2lvbiB0aWNrXCIgZHJpdmVzIGV2ZXJ5dGhpbmcgdGltZS1iYXNlZDogaXQgcmVwYWludHMgdGhlXG4gKiBzdGF0dXMgYmFyIGFuZCBub3RpY2VzIGBkaXNjb25uZWN0ZWRgIFx1MjE5MiBzY2hlZHVsZXMgb25lIHJlY29ubmVjdCBhdCBhIHRpbWUuXG4gKiBBbGwgdGltZXJzIGFyZSBvd25lZCBoZXJlIGFuZCB0b3JuIGRvd24gaW4gYHN0b3BTeW5jKClgL2BvbnVubG9hZGAuXG4gKi9cblxuaW1wb3J0IHsgTm90aWNlLCBQbHVnaW4gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEFwcCwgUGx1Z2luTWFuaWZlc3QgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBSZXZva2VkRXJyb3IsIFN5bmNDbGllbnQsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLmpzJztcbmltcG9ydCB7IE9ic2lkaWFuV2F0Y2hBZGFwdGVyLCBSZXNjYW5TY2hlZHVsZXIgfSBmcm9tICcuL2FkYXB0ZXJzL29ic2lkaWFuLXdhdGNoLmpzJztcbmltcG9ydCB7IEh0dHBCbG9iU3RvcmUgfSBmcm9tICcuL2Jsb2JzdG9yZS5qcyc7XG5pbXBvcnQge1xuICBkZWZhdWx0RGV2aWNlTmFtZSxcbiAgZGV0ZWN0RGV2aWNlVHlwZSxcbiAgaXNMaW5rZWQsXG4gIG5vcm1hbGl6ZVBsdWdpbkRhdGEsXG4gIGRlZmF1bHRQbHVnaW5EYXRhLFxuICB0eXBlIFZhdWx0U3luY1BsdWdpbkRhdGEsXG59IGZyb20gJy4vZGF0YS5qcyc7XG5pbXBvcnQgeyBwYWlyT3V0Y29tZU1lc3NhZ2UsIHBhaXJXaXRoV29ya2VyIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB0eXBlIHsgUGFpck91dGNvbWUgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyIH0gZnJvbSAnLi9wcm90b2NvbC1oYW5kbGVyLmpzJztcbmltcG9ydCB7IFJlY29ubmVjdFN1cGVydmlzb3IgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IEJhY2tvZmZPcHRpb25zIH0gZnJvbSAnLi9yZWNvbm5lY3QuanMnO1xuaW1wb3J0IHsgVmF1bHRTeW5jU2V0dGluZ1RhYiB9IGZyb20gJy4vc2V0dGluZ3MuanMnO1xuaW1wb3J0IHsgU3RhdHVzQmFySW5kaWNhdG9yIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuaW1wb3J0IHsgV2ViU29ja2V0VHJhbnNwb3J0IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHR5cGUgeyBXZWJTb2NrZXRGYWN0b3J5IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHsgbm9ybWFsaXplV29ya2VyVXJsIH0gZnJvbSAnLi93b3JrZXJhcGkuanMnO1xuXG4vKiogVGhlIGluLXZhdWx0IGRldmljZSBtYXJrZXIgc2hhcmVkIHdpdGggdGhlIGRhZW1vbi9DTEkgKEZSLTQ0IGhhbmRzaGFrZSkuICovXG5jb25zdCBERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvZGV2aWNlLmpzb24nO1xuY29uc3QgTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZSc7XG5jb25zdCBTVVBFUlZJU0lPTl9USUNLX01TID0gMTAwMDtcblxuLyoqIFRpbWVyIGhhbmRsZXMgKG51bWJlciBpbiB0aGUgRE9NLCBgVGltZW91dGAgd2hlbiBOb2RlIHR5cGVzIGxlYWsgaW4pLiAqL1xudHlwZSBUaW1lckhhbmRsZSA9IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPjtcblxuLyoqIEluamVjdGFibGUgc2VhbXMgc28gdW5pdCB0ZXN0cyBuZWVkIG5vIHJlYWwgT2JzaWRpYW4vbmV0d29yay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luT3ZlcnJpZGVzIHtcbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoO1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xuICBub3c/OiAoKSA9PiBudW1iZXI7XG4gIC8qKiBSZWNvbm5lY3QgYmFja29mZiBrbm9icyAodGVzdHMgaW5qZWN0IGEgZGV0ZXJtaW5pc3RpYyByYW5kb20pLiAqL1xuICByZWNvbm5lY3Q/OiBCYWNrb2ZmT3B0aW9ucztcbn1cblxuZXhwb3J0IGNsYXNzIFZhdWx0U3luY1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSBkZWZhdWx0UGx1Z2luRGF0YSgpO1xuICAvKiogVGhlIGxpdmUgc3luYyBjbGllbnQgKG51bGwgd2hpbGUgdW5saW5rZWQvc3RvcHBlZCkuICovXG4gIGNsaWVudDogU3luY0NsaWVudCB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgb3ZlcnJpZGVzOiBQbHVnaW5PdmVycmlkZXM7XG4gIHByaXZhdGUgd2F0Y2hlcjogT2JzaWRpYW5XYXRjaEFkYXB0ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNjYW46IFJlc2NhblNjaGVkdWxlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0JhcjogU3RhdHVzQmFySW5kaWNhdG9yIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdHVzQmFySXRlbTogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0aWNrSGFuZGxlOiBUaW1lckhhbmRsZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlY29ubmVjdFRpbWVyOiBUaW1lckhhbmRsZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN1cGVydmlzb3IgPSBuZXcgUmVjb25uZWN0U3VwZXJ2aXNvcigpO1xuICAvKiogU2V0IHdoZW4gdGhlIHdvcmtlciByZWplY3RlZCB0aGUgdG9rZW4gXHUyMDE0IHJlY29ubmVjdGluZyBjYW5ub3QgaGVscC4gKi9cbiAgcHJpdmF0ZSBhdXRoRmFpbGVkID0gZmFsc2U7XG4gIHByaXZhdGUgc3RhdHVzTm90ZSA9ICcnO1xuICBwcml2YXRlIHJlYWRvbmx5IHN5bmNMb2c6IExvZ0FkYXB0ZXIgPSB7XG4gICAgZGVidWc6ICguLi5hcmdzOiB1bmtub3duW10pID0+IGNvbnNvbGUuZGVidWcoJ1t2c2FdJywgLi4uYXJncyksXG4gICAgaW5mbzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gY29uc29sZS5pbmZvKCdbdnNhXScsIC4uLmFyZ3MpLFxuICAgIHdhcm46ICguLi5hcmdzOiB1bmtub3duW10pID0+IGNvbnNvbGUud2FybignW3ZzYV0nLCAuLi5hcmdzKSxcbiAgICBlcnJvcjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gY29uc29sZS5lcnJvcignW3ZzYV0nLCAuLi5hcmdzKSxcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIHJldHVybiB0aGlzLm92ZXJyaWRlcy5mZXRjaEltcGwgPz8gZmV0Y2g7XG4gIH1cblxuICBnZXQgbGlua2VkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpc0xpbmtlZCh0aGlzLmRhdGEpO1xuICB9XG5cbiAgb3ZlcnJpZGUgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YSA9IG5vcm1hbGl6ZVBsdWdpbkRhdGEoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFZhdWx0U3luY1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIoXG4gICAgICAoYWN0aW9uLCBoYW5kbGVyKSA9PiB0aGlzLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXIoYWN0aW9uLCBoYW5kbGVyKSxcbiAgICAgIChsaW5rKSA9PiB0aGlzLmhhbmRsZVBhaXJEZWVwTGluayhsaW5rLnVybCwgbGluay5jb2RlKSxcbiAgICApO1xuICAgIC8vIENoZWFwIGZvY3VzLWRyaXZlbiByZXNjYW4gKEZSLTEyKTogZXZlcnkgbm90ZS9hcHAgc3dpdGNoIHBva2VzIHRoZVxuICAgIC8vIHNjaGVkdWxlciwgd2hpY2ggY29hbGVzY2VzIGludG8gYXQgbW9zdCBvbmUgY3ljbGUgcGVyIGRlYm91bmNlIHdpbmRvdy5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQodGhpcy5hcHAud29ya3NwYWNlLm9uKCdhY3RpdmUtbGVhZi1jaGFuZ2UnLCAoKSA9PiB0aGlzLnJlc2Nhbj8ucG9rZSgpKSk7XG4gICAgaWYgKHRoaXMubGlua2VkKSBhd2FpdCB0aGlzLnN0YXJ0U3luYygpO1xuICB9XG5cbiAgb3ZlcnJpZGUgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wU3luYygpO1xuICB9XG5cbiAgLy8gLS0tIHBlcnNpc3RlbmNlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc2F2ZVBsdWdpbkRhdGEoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLmRhdGEpO1xuICB9XG5cbiAgLy8gLS0tIHBhaXJpbmcgKHNldHRpbmdzIHRhYiArIGRlZXAgbGluaykgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogUGFpciBmcm9tIHRoZSBzZXR0aW5ncyBmb3JtIChmaWVsZHMgYWxyZWFkeSBsaXZlIGluIGB0aGlzLmRhdGFgKS4gKi9cbiAgYXN5bmMgcGFpckZyb21TZXR0aW5ncyhjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgICByZXR1cm4gb3V0Y29tZTtcbiAgfVxuXG4gIC8qKiBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cy9wYWlyP3VybD1cdTIwMjYmY29kZT1cdTIwMjYgKHByb3RvY29sLWhhbmRsZXIudHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZVBhaXJEZWVwTGluayh1cmw6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubGlua2VkKSB7XG4gICAgICBpZiAobm9ybWFsaXplV29ya2VyVXJsU2FmZSh1cmwpID09PSBub3JtYWxpemVXb3JrZXJVcmxTYWZlKHRoaXMuZGF0YS51cmwpKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogdGhpcyB2YXVsdCBpcyBhbHJlYWR5IHBhaXJlZCB3aXRoIHRoYXQgd29ya2VyLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIHBhaXJlZCB3aXRoIGEgZGlmZmVyZW50IHdvcmtlci4gVW5saW5rIGl0IGluIHNldHRpbmdzIGZpcnN0LicsXG4gICAgICAgICAgMTAwMDAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHBhaXJXaXRoV29ya2VyKHtcbiAgICAgIHVybCxcbiAgICAgIGNvZGUsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogZGV0ZWN0RGV2aWNlVHlwZSgpLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcGx5UGFpck91dGNvbWUob3V0Y29tZSwgZGV2aWNlTmFtZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5UGFpck91dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUsIGRldmljZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyAhPT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpLCAxMDAwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGF0YS51cmwgPSBvdXRjb21lLnVybDtcbiAgICB0aGlzLmRhdGEudG9rZW4gPSBvdXRjb21lLnRva2VuO1xuICAgIHRoaXMuZGF0YS5kZXZpY2VJZCA9IG91dGNvbWUuZGV2aWNlSWQ7XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBkZXZpY2VOYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVEZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdHlwZWQgPSB0aGlzLmRhdGEuZGV2aWNlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHR5cGVkICE9PSAnJyA/IHR5cGVkIDogZGVmYXVsdERldmljZU5hbWUoKTtcbiAgfVxuXG4gIC8qKiBXcml0ZSB0aGUgRlItNDQgbWFya2VyIHRoZSBDTEkvZGFlbW9uIHJlYWQgdG8gZGV0ZWN0IGRvdWJsZS1jbGllbnRzLiAqL1xuICBwcml2YXRlIGFzeW5jIHdyaXRlRGV2aWNlTWFya2VyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybjtcbiAgICBjb25zdCBzdG9yYWdlID0gbmV3IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIoeyBhZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyIH0pO1xuICAgIGNvbnN0IG1hcmtlciA9IHtcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBsaW5rZWRBdDogdGhpcy5ub3coKSxcbiAgICB9O1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcbiAgICAgICAgREVWSUNFX01BUktFUl9WQVVMVF9QQVRILFxuICAgICAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoYCR7SlNPTi5zdHJpbmdpZnkobWFya2VyLCBudWxsLCAyKX1cXG5gKSxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuc3luY0xvZy53YXJuKCdmYWlsZWQgdG8gd3JpdGUgZGV2aWNlIG1hcmtlcicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gc3luYyBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIEJ1aWxkIGV2ZXJ5dGhpbmcgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChpZGVtcG90ZW50IHJlc3RhcnQpLiAqL1xuICBwcml2YXRlIGFzeW5jIHN0YXJ0U3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgdGhpcy5zdG9wU3luYygpO1xuXG4gICAgY29uc3QgeyB1cmwsIHRva2VuLCBkZXZpY2VJZCB9ID0gdGhpcy5kYXRhO1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgc3RvcmFnZSA9IG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHsgYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlciB9KTtcbiAgICBhd2FpdCB0aGlzLndhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlKTtcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTeW5jQ2xpZW50KHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgdHJhbnNwb3J0OiAoKSA9PiBuZXcgV2ViU29ja2V0VHJhbnNwb3J0KHsgdXJsLCB0b2tlbiwgd3NGYWN0b3J5OiB0aGlzLm92ZXJyaWRlcy53c0ZhY3RvcnkgfSksXG4gICAgICBibG9iU3RvcmU6IG5ldyBIdHRwQmxvYlN0b3JlKHsgYmFzZVVybDogdXJsLCB0b2tlbiwgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCB9KSxcbiAgICAgIHN0b3JhZ2UsXG4gICAgICBzZXR0aW5nczogeyBvYnNpZGlhblN5bmM6IHRoaXMuZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMgfSxcbiAgICAgIGxvZzogdGhpcy5zeW5jTG9nLFxuICAgICAgbm93OiB0aGlzLm5vdyxcbiAgICB9KTtcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLmF1dGhGYWlsZWQgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1c05vdGUgPSAnJztcbiAgICB0aGlzLnN1cGVydmlzb3IgPSBuZXcgUmVjb25uZWN0U3VwZXJ2aXNvcih0aGlzLm92ZXJyaWRlcy5yZWNvbm5lY3QgPz8ge30pO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7IC8vIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gXHUyMTkyIGxpdmUgbW9kZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3N0YXJ0dXAgc3luYyBmYWlsZWQnKTtcbiAgICB9XG5cbiAgICAvLyBMaXZlIHdhdGNoaW5nOiB2YXVsdCBldmVudHMgKGRlYm91bmNlZCBpbiBjb3JlKSArIHJlc2NhbiBob29rcy5cbiAgICB0aGlzLndhdGNoZXIgPSBuZXcgT2JzaWRpYW5XYXRjaEFkYXB0ZXIoeyB2YXVsdDogdGhpcy5hcHAudmF1bHQgfSk7XG4gICAgY2xpZW50LnN0YXJ0V2F0Y2hpbmcodGhpcy53YXRjaGVyKTtcbiAgICB0aGlzLnJlc2NhbiA9IG5ldyBSZXNjYW5TY2hlZHVsZXIoe1xuICAgICAgaW50ZXJ2YWxNczogdGhpcy5kYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjICogMTAwMCxcbiAgICB9KTtcbiAgICB0aGlzLnJlc2Nhbi5zdGFydCgoKSA9PiB7XG4gICAgICB2b2lkIGNsaWVudC50cmlnZ2VyU3luYygpLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3Jlc2NhbiBmYWlsZWQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gU3RhdHVzIGJhciArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2sgdGhhdCByZXBhaW50cyBpdCBhbmQgc3VwZXJ2aXNlc1xuICAgIC8vIHJlY29ubmVjdGlvbi5cbiAgICBjb25zdCBpdGVtID0gdGhpcy5hZGRTdGF0dXNCYXJJdGVtKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gaXRlbTtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG5ldyBTdGF0dXNCYXJJbmRpY2F0b3IoaXRlbSk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIFRlYXIgZG93biBldmVyeSB0aW1lciwgd2F0Y2hlciwgc29ja2V0LCBhbmQgVUkgYXJ0aWZhY3QuIElkZW1wb3RlbnQuICovXG4gIHByaXZhdGUgc3RvcFN5bmMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0VGltZXIgIT09IG51bGwpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdFRpbWVyKTtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy50aWNrSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMudGlja0hhbmRsZSk7XG4gICAgICB0aGlzLnRpY2tIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlclxuICAgIHRoaXMuY2xpZW50ID0gbnVsbDtcbiAgICB0aGlzLndhdGNoZXIgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gIH1cblxuICAvLyAtLS0gdXNlciBhY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzeW5jTm93KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogbm90IHBhaXJlZCB5ZXQgXHUyMDE0IGFkZCB5b3VyIHdvcmtlciBVUkwgYW5kIGEgcGFpcmluZyBjb2RlIGluIHNldHRpbmdzLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xpZW50LnRyaWdnZXJTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgPyAnVmF1bHRTeW5jOiBvZmZsaW5lIFx1MjAxNCBjaGFuZ2VzIHdpbGwgc3luYyB3aGVuIHRoZSB3b3JrZXIgaXMgcmVhY2hhYmxlLidcbiAgICAgICAgICA6ICdWYXVsdFN5bmM6IHVwIHRvIGRhdGUuJyxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAnc3luYyBub3cgZmFpbGVkJyk7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHN5bmMgZmFpbGVkIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlIGZvciBkZXRhaWxzLicpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVubGluaygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gICAgLy8gQ2xlYXIgbG9jYWwgc3luYyBzdGF0ZSAoZGV2aWNlIG1hcmtlciArIGluZGV4KSBzbyBhIGZ1dHVyZSBjbGllbnQgXHUyMDE0XG4gICAgLy8gdGhpcyBwbHVnaW4gYWZ0ZXIgYSByZS1wYWlyLCB0aGUgZGFlbW9uLCB0aGUgQ0xJIFx1MjAxNCBzdGFydHMgY2xlYW5cbiAgICAvLyAoRlItNDQ6IHN0YWxlIHN0YXRlIHdvdWxkIG1ha2UgaXQgcmVmdXNlIG9yIG1pcy1zeW5jKS5cbiAgICBjb25zdCBzdG9yYWdlID0gbmV3IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIoeyBhZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyIH0pO1xuICAgIGF3YWl0IHN0b3JhZ2UuZGVsZXRlRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgIGF3YWl0IHN0b3JhZ2UuZGVsZXRlRmlsZShMT0NBTF9JTkRFWF9WQVVMVF9QQVRIKTtcbiAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAuLi5kZWZhdWx0UGx1Z2luRGF0YSgpLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5kYXRhLmRldmljZU5hbWUsXG4gICAgICBzZXR0aW5nczogdGhpcy5kYXRhLnNldHRpbmdzLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIG5ldyBOb3RpY2UoXG4gICAgICAnVmF1bHRTeW5jOiB1bmxpbmtlZC4gUmV2b2tlIHRoaXMgZGV2aWNlIGZyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQgaWYgeW91IGFyZSBkb25lIHdpdGggaXQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlSZXNjYW5JbnRlcnZhbChzZWNvbmRzOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHNlY29uZHMpKTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5yZXNjYW4/LnNldEludGVydmFsTXModGhpcy5kYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjICogMTAwMCk7XG4gIH1cblxuICBhc3luYyBhcHBseU9ic2lkaWFuU3luYyhlbmFibGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYyA9IGVuYWJsZWQ7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIG5ldyBOb3RpY2UoXG4gICAgICBlbmFibGVkXG4gICAgICAgID8gJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIHN5bmMgYWZ0ZXIgdGhlIG5leHQgcmVjb25uZWN0ICh0aGUgd29ya2VyXFx1MjAxOXMgcGVyLXZhdWx0IHNldHRpbmcgdGFrZXMgcHJlY2VkZW5jZSkuJ1xuICAgICAgICA6ICdWYXVsdFN5bmM6IC5vYnNpZGlhbi8gd2lsbCBiZSBleGNsdWRlZCBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QuJyxcbiAgICApO1xuICB9XG5cbiAgLy8gLS0tIHN1cGVydmlzaW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRpY2soKTogdm9pZCB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICB0aGlzLnN0YXR1c0Jhcj8udXBkYXRlKFxuICAgICAgc3RhdHVzLFxuICAgICAgeyB1cmw6IHRoaXMuZGF0YS51cmwsIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSwgbm90ZTogdGhpcy5zdGF0dXNOb3RlIH0sXG4gICAgICB0aGlzLm5vdygpLFxuICAgICk7XG4gICAgaWYgKHRoaXMuYXV0aEZhaWxlZCkgcmV0dXJuOyAvLyB0b2tlbiByZWplY3RlZDogcmVjb25uZWN0aW5nIGNhbm5vdCBmaXggaXRcbiAgICBjb25zdCBkZWNpc2lvbiA9IHRoaXMuc3VwZXJ2aXNvci5jb25zaWRlcihzdGF0dXMuc3RhdGUpO1xuICAgIGlmIChkZWNpc2lvbi5hY3Rpb24gPT09ICd3YWl0JykgcmV0dXJuO1xuICAgIHRoaXMuc3VwZXJ2aXNvci5hY2tub3dsZWRnZWQoKTtcbiAgICB0aGlzLnNjaGVkdWxlUmVjb25uZWN0KGRlY2lzaW9uLmRlbGF5TXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29ubmVjdChkZWxheU1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkgcmV0dXJuOyAvLyBvbmUgaW4gZmxpZ2h0LCBhbHdheXNcbiAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjbGllbnRcbiAgICAgICAgLnJlY29ubmVjdCgpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3JlY29ubmVjdCBmYWlsZWQnKTtcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7IC8vIGhhbmRsZVN5bmNFcnJvciBuZXZlciB0aHJvd3M7IGJlbHQgYW5kIGJyYWNlc1xuICAgIH0sIGRlbGF5TXMpO1xuICB9XG5cbiAgLyoqIERpc3Rpbmd1aXNoIGZhdGFsIGF1dGggZmFpbHVyZXMgZnJvbSB0cmFuc2llbnQgbmV0d29yayB0cm91YmxlLiAqL1xuICBwcml2YXRlIGhhbmRsZVN5bmNFcnJvcihlcnJvcjogdW5rbm93biwgY29udGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmV2b2tlZEVycm9yIHx8IGVycm9yIGluc3RhbmNlb2YgVW5hdXRob3JpemVkRXJyb3IpIHtcbiAgICAgIHRoaXMuYXV0aEZhaWxlZCA9IHRydWU7XG4gICAgICB0aGlzLnN0YXR1c05vdGUgPSAnRGV2aWNlIHRva2VuIHJlamVjdGVkIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJztcbiAgICAgIHRoaXMuc3luY0xvZy5lcnJvcihjb250ZXh0LCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICAnVmF1bHRTeW5jOiB0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KS4gVW5saW5rIGFuZCByZS1wYWlyIGZyb20gc2V0dGluZ3MuJyxcbiAgICAgICAgMTAwMDAsXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN5bmNMb2cud2Fybihjb250ZXh0LCBlcnJvcik7IC8vIG9mZmxpbmUvcHJvdG9jb2w6IGJhY2tvZmYga2VlcHMgcmV0cnlpbmdcbiAgfVxuXG4gIC8qKiBGUi00NDogd2FybiB3aGVuIHRoZSB2YXVsdCdzIHN0YXRlIGRpciBiZWxvbmdzIHRvIGFub3RoZXIgY2xpZW50LiAqL1xuICBwcml2YXRlIGFzeW5jIHdhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IG1hcmtlcjogeyBkZXZpY2VJZD86IHVua25vd247IGRldmljZU5hbWU/OiB1bmtub3duOyB1cmw/OiB1bmtub3duIH07XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgICAgbWFya2VyID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKSBhcyB0eXBlb2YgbWFya2VyO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyBubyBtYXJrZXIgKG9yIHVucmVhZGFibGUpIFx1MjAxNCBub3RoaW5nIHRvIHdhcm4gYWJvdXRcbiAgICB9XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIG1hcmtlci5kZXZpY2VJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIG1hcmtlci5kZXZpY2VJZCAhPT0gdGhpcy5kYXRhLmRldmljZUlkXG4gICAgKSB7XG4gICAgICBjb25zdCBuYW1lID0gdHlwZW9mIG1hcmtlci5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IG1hcmtlci5kZXZpY2VOYW1lIDogbWFya2VyLmRldmljZUlkO1xuICAgICAgY29uc3Qgd2hlcmUgPSB0eXBlb2YgbWFya2VyLnVybCA9PT0gJ3N0cmluZycgPyBtYXJrZXIudXJsIDogJ2Egd29ya2VyJztcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBWYXVsdFN5bmM6IHRoaXMgdmF1bHQgYWxyZWFkeSBoYXMgc3luYyBzdGF0ZSBmb3IgZGV2aWNlIFwiJHtuYW1lfVwiIChsaW5rZWQgdG8gJHt3aGVyZX0pLiBgICtcbiAgICAgICAgICAnT25lIHN5bmMgY2xpZW50IHBlciBtYWNoaW5lIHBlciB2YXVsdCBcdTIwMTQgcnVubmluZyB0d28gZG91YmxlLWNvbW1pdHMgZXZlcnkgY2hhbmdlLiAnICtcbiAgICAgICAgICAnVW5saW5rIHRoZSBvdGhlciBjbGllbnQgKG9yIGNsZWFyIC52YXVsdHN5bmNmb3JhZ2VudHMvKSBpZiB0aGlzIGlzIHVuZXhwZWN0ZWQuJyxcbiAgICAgICAgMTUwMDAsXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmxTYWZlKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaW5wdXQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFZhdWx0IHBhdGggdXRpbGl0aWVzLlxuICpcbiAqIFZhdWx0LWludGVybmFsIHBhdGhzIGFyZSBQT1NJWC1ub3JtYWxpemVkIHN0cmluZ3MgcmVsYXRpdmUgdG8gdGhlIHZhdWx0IHJvb3Q6XG4gKiAgIC0gYWx3YXlzIHN0YXJ0IHdpdGggYC9gIChgL2EvYi5tZGApOyB0aGUgdmF1bHQgcm9vdCBpdHNlbGYgaXMgYC9gXG4gKiAgIC0gc2VnbWVudHMgc2VwYXJhdGVkIGJ5IGAvYDsgbm8gdHJhaWxpbmcgc2xhc2gsIG5vIGAuYC9gLi5gIHNlZ21lbnRzLFxuICogICAgIG5vIGR1cGxpY2F0ZSBzbGFzaGVzXG4gKiAgIC0gbmV2ZXIgZXNjYXBlIHRoZSByb290OiBhbnkgYC4uYCB0aGF0IHdvdWxkIHBvcCBhYm92ZSBgL2AgaXMgcmVqZWN0ZWRcbiAqXG4gKiBCYWNrc2xhc2hlcyBhcmUgY29udmVydGVkIHRvIGAvYCAoV2luZG93cyBjYWxsZXJzIHJvdXRpbmVseSBoYW5kIHVzXG4gKiBgZGlyXFxmaWxlLm1kYCksIGJ1dCBhYnNvbHV0ZSBXaW5kb3dzIHBhdGhzIChkcml2ZSBsZXR0ZXJzIGxpa2UgYEM6L2AsIFVOQ1xuICogYFxcXFxzZXJ2ZXJcXHNoYXJlYCkgYXJlIHJlamVjdGVkIFx1MjAxNCBhIHZhdWx0IHBhdGggaXMgbmV2ZXIgYWJzb2x1dGUgaW4gdGhlIGhvc3RcbiAqIGZpbGVzeXN0ZW0gc2Vuc2UuXG4gKi9cblxuLyoqIEEgdmF1bHQtaW50ZXJuYWwsIFBPU0lYLW5vcm1hbGl6ZWQgcGF0aCBzdHJpbmcgKGUuZy4gYC9ub3Rlcy90b2RvLm1kYCkuICovXG5leHBvcnQgdHlwZSBWYXVsdFBhdGggPSBzdHJpbmc7XG5cbi8qKiBUaHJvd24gd2hlbiBhIHBhdGggY2Fubm90IGJlIGludGVycHJldGVkIGFzIGEgdmF1bHQtaW50ZXJuYWwgcGF0aC4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkVmF1bHRQYXRoRXJyb3InO1xuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgdXNlci0gb3IgcGxhdGZvcm0tc3VwcGxpZWQgcGF0aCBpbnRvIGNhbm9uaWNhbCB2YXVsdCBmb3JtLlxuICpcbiAqIEFjY2VwdGVkOiBgYS9iLm1kYCAocm9vdC1yZWxhdGl2ZSB3aXRob3V0IGxlYWRpbmcgc2xhc2gpLCBgL2EvYi5tZGAsXG4gKiBgYVxcYi5tZGAgKGJhY2tzbGFzaCBjb252ZXJzaW9uKSwgYGEvLi9iLm1kYCwgYGEvYi8uLi9jLm1kYCAoaW50ZXJpb3IgYC4uYFxuICogcmVzb2x2ZXMpLCBkdXBsaWNhdGUgc2xhc2hlcywgdHJhaWxpbmcgc2xhc2hlcy5cbiAqXG4gKiBSZWplY3RlZDogYC4uYCBlc2NhcGluZyB0aGUgcm9vdCAoYC8uLi9hYCwgYC9hLy4uLy4uYCksIGFic29sdXRlIFdpbmRvd3NcbiAqIGRyaXZlIHBhdGhzIChgQzovdmF1bHQvYS5tZGAsIGBDOlxcdmF1bHRcXGEubWRgKSwgVU5DIHBhdGhzIChgXFxcXHNydlxcc2hhcmVgKSxcbiAqIGxlYWRpbmcgYC8vYCwgTlVMIGJ5dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplVmF1bHRQYXRoKGlucHV0OiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBpZiAodHlwZW9mIGlucHV0ICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggbXVzdCBiZSBhIHN0cmluZywgZ290ICR7dHlwZW9mIGlucHV0fWApO1xuICB9XG4gIGlmIChpbnB1dC5pbmNsdWRlcygnXFwwJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKGBWYXVsdCBwYXRoIGNvbnRhaW5zIE5VTCBieXRlOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gKTtcbiAgfVxuICBpZiAoL15bYS16QS1aXTovLnRlc3QoaW5wdXQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IGJlIGFuIGFic29sdXRlIGhvc3QgcGF0aCAoZHJpdmUgbGV0dGVyKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG4gIGlmIChpbnB1dC5zdGFydHNXaXRoKCdcXFxcXFxcXCcpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IGJlIGEgVU5DIHBhdGg6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGNvbnZlcnRlZCA9IGlucHV0LnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvLycpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IHN0YXJ0IHdpdGggXCIvL1wiIChVTkMgb3IgcHJvdG9jb2wtc3R5bGUgcGF0aCk6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2YgY29udmVydGVkLnNwbGl0KCcvJykpIHtcbiAgICBpZiAoc2VnbWVudCA9PT0gJycgfHwgc2VnbWVudCA9PT0gJy4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VnbWVudCA9PT0gJy4uJykge1xuICAgICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICAgIGBWYXVsdCBwYXRoIGVzY2FwZXMgdGhlIHZhdWx0IHJvb3Q6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzZWdtZW50cy5wb3AoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBzZWdtZW50cy5wdXNoKHNlZ21lbnQpO1xuICB9XG4gIHJldHVybiBzZWdtZW50cy5sZW5ndGggPT09IDAgPyAnLycgOiBgLyR7c2VnbWVudHMuam9pbignLycpfWA7XG59XG5cbi8qKlxuICogSm9pbiBhIGJhc2UgdmF1bHQgcGF0aCB3aXRoIG9uZSBvciBtb3JlIHJlbGF0aXZlIHBhdGggcGFydHMuXG4gKlxuICogRWFjaCBwYXJ0IG11c3QgYmUgcmVsYXRpdmUgKG5vIGxlYWRpbmcgYC9gIGFmdGVyIGJhY2tzbGFzaCBjb252ZXJzaW9uKSBhbmRcbiAqIGlzIGFwcGVuZGVkIHRvIHRoZSBiYXNlIGJlZm9yZSBub3JtYWxpemF0aW9uOyBgLi5gIGluc2lkZSBwYXJ0cyBtYXkgbm90XG4gKiBlc2NhcGUgdGhlIHJlc3VsdGluZyByb290LlxuICovXG5leHBvcnQgZnVuY3Rpb24gam9pblBhdGgoYmFzZTogc3RyaW5nLCAuLi5wYXJ0czogcmVhZG9ubHkgc3RyaW5nW10pOiBWYXVsdFBhdGgge1xuICBsZXQgY29tYmluZWQgPSBub3JtYWxpemVWYXVsdFBhdGgoYmFzZSk7XG4gIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgIGNvbnN0IGNvbnZlcnRlZCA9IHBhcnQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICAgIGlmIChjb252ZXJ0ZWQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICBgam9pblBhdGggcGFydHMgbXVzdCBiZSByZWxhdGl2ZSwgZ290ICR7SlNPTi5zdHJpbmdpZnkocGFydCl9YCxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbWJpbmVkID0gYCR7Y29tYmluZWQgPT09ICcvJyA/ICcnIDogY29tYmluZWR9LyR7Y29udmVydGVkfWA7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZVZhdWx0UGF0aChjb21iaW5lZCk7XG59XG5cbi8qKlxuICogUGFyZW50IGRpcmVjdG9yeSBvZiBhIHZhdWx0IHBhdGguIFRoZSBwYXJlbnQgb2YgYC9gIGlzIGAvYCAodGhlIHJvb3QgaGFzIG5vXG4gKiBwYXJlbnQgYWJvdmUgaXQpOyB3YWxrIGB3aGlsZSAocCAhPT0gcGFyZW50UGF0aChwKSlgIHN0eWxlIGxvb3BzIHRlcm1pbmF0ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcmVudFBhdGgocGF0aDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcvJztcbiAgY29uc3QgbGFzdFNsYXNoID0gbm9ybWFsaXplZC5sYXN0SW5kZXhPZignLycpO1xuICByZXR1cm4gbGFzdFNsYXNoID09PSAwID8gJy8nIDogbm9ybWFsaXplZC5zbGljZSgwLCBsYXN0U2xhc2gpO1xufVxuXG4vKipcbiAqIEZpbmFsIHBhdGggc2VnbWVudC4gYGJhc2VuYW1lKCcvYS9iLm1kJylgIFx1MjE5MiBgYi5tZGA7IGBiYXNlbmFtZSgnLycpYCBcdTIxOTIgYCcnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2VuYW1lKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiAnJztcbiAgcmV0dXJuIG5vcm1hbGl6ZWQuc2xpY2Uobm9ybWFsaXplZC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59XG4iLCAiLyoqXG4gKiBMb2dpY2FsIGNsb2NrIG9wZXJhdGlvbnMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0KS5cbiAqXG4gKiBDbG9ja3MgYXJlIHBlci1maWxlIG1vbm90b25pYyBjb3VudGVycyBvd25lZCBieSB0aGUgc3luYyBhdXRob3JpdHkgKHRoZVxuICogRHVyYWJsZSBPYmplY3QpLiBBIGNsb2NrIHBhaXJzIHRoZSBjb3VudGVyIHdpdGggdGhlIGlkIG9mIHRoZSBkZXZpY2UgdGhhdFxuICogcHJvZHVjZWQgaXQuIE9yZGVyaW5nIGlzIGZ1bGx5IGRldGVybWluaXN0aWMgb24gZXZlcnkgY2xpZW50OlxuICpcbiAqICAgMS4gaGlnaGVyIGBjb3VudGVyYCB3aW5zO1xuICogICAyLiBleGFjdCBjb3VudGVyIHRpZSBcdTIxOTIgbGV4aWNvZ3JhcGhpY2FsbHkgZ3JlYXRlciBgZGV2aWNlSWRgIHdpbnNcbiAqICAgICAgKHBsYWluIEpTIHN0cmluZyBjb21wYXJpc29uLCBpLmUuIGJ5IFVURi0xNiBjb2RlIHVuaXRzKTtcbiAqICAgMy4gaWRlbnRpY2FsIGNvdW50ZXIgKmFuZCogaWRlbnRpY2FsIGRldmljZUlkIFx1MjE5MiB0aGUgY2xvY2tzIGFyZSBlcXVhbC5cbiAqXG4gKiBXYWxsLWNsb2NrIHRpbWUgbmV2ZXIgcGFydGljaXBhdGVzIGluIG9yZGVyaW5nIChkaXNwbGF5LW9ubHkgcGVyIFx1MDBBNzQpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKiBSZXN1bHQgb2YgYGNvbXBhcmVDbG9ja3NgOiBzaWduIG9mIGBhYCB2cyBgYmAgKHBvc2l0aXZlIFx1MjFEMiBgYWAgd2lucykuICovXG5leHBvcnQgdHlwZSBDbG9ja0NvbXBhcmlzb24gPSAtMSB8IDAgfCAxO1xuXG4vKipcbiAqIENvbXBhcmUgdHdvIGxvZ2ljYWwgY2xvY2tzLlxuICpcbiAqIFJldHVybnMgYDFgIHdoZW4gYGFgIHdpbnMsIGAtMWAgd2hlbiBgYmAgd2lucywgYDBgIHdoZW4gdGhlIGNsb2NrcyBhcmVcbiAqIGlkZW50aWNhbCAoc2FtZSBjb3VudGVyICphbmQqIHNhbWUgZGV2aWNlSWQgXHUyMDE0IGluIHByYWN0aWNlIG9ubHkgd2hlblxuICogY29tcGFyaW5nIGEgY2xvY2sgd2l0aCBpdHNlbGYpLiBDYWxsZXJzIHRoYXQgbXVzdCBwaWNrIGEgc2lkZSBvbiBgMGBcbiAqIHNob3VsZCBkbyBzbyBleHBsaWNpdGx5IGFuZCBkb2N1bWVudCB0aGUgY2hvaWNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGFyZUNsb2NrcyhhOiBMb2dpY2FsQ2xvY2ssIGI6IExvZ2ljYWxDbG9jayk6IENsb2NrQ29tcGFyaXNvbiB7XG4gIGlmIChhLmNvdW50ZXIgIT09IGIuY291bnRlcikgcmV0dXJuIGEuY291bnRlciA+IGIuY291bnRlciA/IDEgOiAtMTtcbiAgaWYgKGEuZGV2aWNlSWQgIT09IGIuZGV2aWNlSWQpIHJldHVybiBhLmRldmljZUlkID4gYi5kZXZpY2VJZCA/IDEgOiAtMTtcbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIGNsb2NrIGEgY29tbWl0IGZyb20gYGRldmljZUlkYCB3b3VsZCByZWNlaXZlIHdoZW4gYnVpbGRpbmcgb24gYHBhcmVudGBcbiAqIChvciBvbiBub3RoaW5nLCB3aGVuIGBwYXJlbnRgIGlzIGFic2VudCk6IHBhcmVudCdzIGNvdW50ZXIgKyAxLlxuICpcbiAqIFRoaXMgaXMgdGhlICp0ZW50YXRpdmUqIGNsb2NrIHVzZWQgYnkgY2xpZW50LXNpZGUgY29uZmxpY3QgcHJlZGljdGlvblxuICogKGByZXNvbHZlLnRzYCk6IHRoZSBETyBhc3NpZ25zIHJlYWwgY291bnRlcnMgd2l0aCB0aGUgc2FtZSBydWxlLCBzbyB0aGVcbiAqIHByZWRpY3Rpb24gbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24gYXMgbG9uZyBhcyBib3RoIHNpZGVzIGJ1aWxkIG9uXG4gKiB0aGUgc2FtZSBwYXJlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXh0Q2xvY2soXG4gIHBhcmVudDogTG9naWNhbENsb2NrIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgZGV2aWNlSWQ6IHN0cmluZyxcbik6IExvZ2ljYWxDbG9jayB7XG4gIHJldHVybiB7IGNvdW50ZXI6IChwYXJlbnQ/LmNvdW50ZXIgPz8gMCkgKyAxLCBkZXZpY2VJZCB9O1xufVxuIiwgIi8qKlxuICogQ29udGVudCBoYXNoaW5nIGFuZCBjb21wcmVzc2lvbiBcdTIwMTQgV2ViIEFQSXMgb25seS5cbiAqXG4gKiBgY3J5cHRvLnN1YnRsZWAgaXMgYXZhaWxhYmxlIGluIE5vZGUgMTgrLCBDbG91ZGZsYXJlIFdvcmtlcnMsXG4gKiBhbmQgT2JzaWRpYW4gKEVsZWN0cm9uKS4gYENvbXByZXNzaW9uU3RyZWFtYCBsaWtld2lzZS4gTm8gTm9kZSBpbXBvcnRzOlxuICogdGhpcyBtb2R1bGUgbXVzdCBydW4gdW5jaGFuZ2VkIGluIGV2ZXJ5IGNsaWVudCAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxuICovXG5cbi8qKiBIYXNoIG9mIGBieXRlc2AgYXMgbG93ZXJjYXNlIHNoYTI1NiBoZXguIE1hdGNoZXMgUjIgYmxvYiBrZXlzIGBibG9icy97c2hhMjU2fWAuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzOiBVaW50OEFycmF5IHwgc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGF0YSA9IHR5cGVvZiBieXRlcyA9PT0gJ3N0cmluZycgPyBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoYnl0ZXMpIDogYnl0ZXM7XG4gIC8vIGBjcnlwdG9gIChub3QgYGdsb2JhbFRoaXMuY3J5cHRvYCk6IHRoZSBiYXJlIGlkZW50aWZpZXIgcmVzb2x2ZXMgaW4gZXZlcnlcbiAgLy8gdGFyZ2V0J3MgdHlwZXMgKERPTSBsaWIsIENsb3VkZmxhcmUgd29ya2VyZCB0eXBlcywgTm9kZSkgXHUyMDE0IHRoZSBxdWFsaWZpZWRcbiAgLy8gZm9ybSBkb2VzIG5vdCwgYmVjYXVzZSB3b3JrZXJzIHR5cGVzIGRlY2xhcmUgaXQgYGNvbnN0YCwgd2hpY2ggbmV2ZXJcbiAgLy8gbWVyZ2VzIGludG8gYHR5cGVvZiBnbG9iYWxUaGlzYC5cbiAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoJ1NIQS0yNTYnLCBkYXRhIGFzIEJ1ZmZlclNvdXJjZSk7XG4gIHJldHVybiB0b0hleChuZXcgVWludDhBcnJheShkaWdlc3QpKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGd6aXAgc3RyZWFtcyBhcmUgYXZhaWxhYmxlIGluIHRoaXMgcnVudGltZS4gT2xkZXIgT2JzaWRpYW4gbW9iaWxlXG4gKiB3ZWJ2aWV3cyBtYXkgbGFjayBgQ29tcHJlc3Npb25TdHJlYW1gOyBjYWxsZXJzIGZhbGwgYmFjayB0byBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cHBvcnRzQ29tcHJlc3Npb24oKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIENvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIHR5cGVvZiBEZWNvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJ1xuICApO1xufVxuXG4vKipcbiAqIEd6aXAgYGRhdGFgLiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IChyZXR1cm5zIGlucHV0IHVuY2hhbmdlZCkgd2hlblxuICogYENvbXByZXNzaW9uU3RyZWFtYCBpcyB1bmF2YWlsYWJsZSBcdTIwMTQgY2FsbCBgc3VwcG9ydHNDb21wcmVzc2lvbigpYCBmaXJzdCBpZlxuICogeW91IG11c3Qga25vdyB3aGljaCBoYXBwZW5lZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICAvLyBgYXMgQnVmZmVyU291cmNlYCAobm90IGBhcyBCbG9iUGFydGApOiB0aGUgbmFtZSBgQnVmZmVyU291cmNlYCByZXNvbHZlcyBpblxuICAvLyBib3RoIERPTSBsaWIgYW5kIHdvcmtlcmQgcnVudGltZSB0eXBlcywgYW5kIGlzIGEgdmFsaWQgQmxvYlBhcnQgaW4gZWFjaC5cbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IENvbXByZXNzaW9uU3RyZWFtKCdnemlwJykpO1xuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKHN0cmVhbSkuYXJyYXlCdWZmZXIoKSk7XG59XG5cbi8qKlxuICogR3VuemlwIGBkYXRhYCBwcm9kdWNlZCBieSBgY29tcHJlc3NgIChpbiBhIHJ1bnRpbWUgdGhhdCBoYWQgZ3ppcCBzdXBwb3J0KS5cbiAqIEZhbGxzIGJhY2sgdG8gaWRlbnRpdHkgd2hlbiBgRGVjb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICBjb25zdCBzdHJlYW0gPSBuZXcgQmxvYihbZGF0YSBhcyBCdWZmZXJTb3VyY2VdKVxuICAgIC5zdHJlYW0oKVxuICAgIC5waXBlVGhyb3VnaChuZXcgRGVjb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG5mdW5jdGlvbiB0b0hleChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgb3V0ICs9IGJ5dGUudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvKipcbiAqIFR5cGVkIGVycm9yIGhpZXJhcmNoeSBzaGFyZWQgYnkgYWxsIGNsaWVudHMgKHBsdWdpbiwgZGFlbW9uLCBDTEkpIGFuZCB0aGVcbiAqIHRlc3Qtc3VpdGUgc2VydmVyLiBFcnJvcnMgY2FycnkgYSBzdGFibGUgbWFjaGluZS1yZWFkYWJsZSBgY29kZWAuXG4gKi9cblxuZXhwb3J0IHR5cGUgRXJyb3JDb2RlID1cbiAgfCAnVU5DTEFJTUVEJ1xuICB8ICdVTkFVVEhPUklaRUQnXG4gIHwgJ1JFVk9LRUQnXG4gIHwgJ0NPTkZMSUNUJ1xuICB8ICdQUk9UT0NPTCdcbiAgfCAnTkVUV09SSyc7XG5cbi8qKiBCYXNlIGNsYXNzIGZvciBhbGwgVmF1bHRTeW5jIGVycm9ycy4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBWYXVsdFN5bmNFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgYWJzdHJhY3QgcmVhZG9ubHkgY29kZTogRXJyb3JDb2RlO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgb3B0aW9ucz86IEVycm9yT3B0aW9ucykge1xuICAgIHN1cGVyKG1lc3NhZ2UsIG9wdGlvbnMpO1xuICAgIHRoaXMubmFtZSA9IG5ldy50YXJnZXQubmFtZTtcbiAgfVxufVxuXG4vKiogV29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBvbiBldmVyeSBBUEkgY2FsbCkuICovXG5leHBvcnQgY2xhc3MgVW5jbGFpbWVkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnVU5DTEFJTUVEJyBhcyBjb25zdDtcbn1cblxuLyoqIFRva2VuIG1pc3NpbmcsIGludmFsaWQsIG9yIG5vdCBhY2NlcHRlZCAoSFRUUCA0MDEgY2xhc3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuYXV0aG9yaXplZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQVVUSE9SSVpFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUaGUgZGV2aWNlIHRva2VuIHdhcyByZXZva2VkOyB0aGUgZGV2aWNlIG11c3QgYmUgcmUtcGFpcmVkLiAqL1xuZXhwb3J0IGNsYXNzIFJldm9rZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdSRVZPS0VEJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgY29tbWl0IHJhY2VkIHdpdGggYSBjb25jdXJyZW50IGVkaXQ7IHRoZSBzZXJ2ZXIgYXJiaXRyYXRlZCAoc2VlIFx1MDBBNzQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZsaWN0RXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnQ09ORkxJQ1QnIGFzIGNvbnN0O1xufVxuXG4vKiogQSBwZWVyIChvciBsb2NhbCBidWcpIHZpb2xhdGVkIHRoZSBwcm90b2NvbDogYmFkIG1lc3NhZ2Ugc2hhcGUsIGJhZCB2ZXJzaW9uLiAqL1xuZXhwb3J0IGNsYXNzIFByb3RvY29sRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUFJPVE9DT0wnIGFzIGNvbnN0O1xufVxuXG4vKiogVHJhbnNwb3J0LWxldmVsIGZhaWx1cmU6IHNvY2tldCBjbG9zZWQsIGZldGNoIHJlZnVzZWQsIHRpbWVvdXQuIFJldHJpYWJsZS4gKi9cbmV4cG9ydCBjbGFzcyBOZXR3b3JrRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnTkVUV09SSycgYXMgY29uc3Q7XG59XG4iLCAiLyoqXG4gKiBUaGUgY2xpZW50J3MgcGVyc2lzdGVkIHN5bmMgc3RhdGUgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMSkuXG4gKlxuICogQSBgTG9jYWxJbmRleGAgbWFwcyBldmVyeSB2YXVsdCBwYXRoIHRoaXMgY2xpZW50IGhhcyBldmVyIHN5bmNlZCB0byB0aGVcbiAqIGxhc3QgdmVyc2lvbiBpdCAqa25vd3MqIHdhcyBhdXRob3JpdGF0aXZlOiBjb250ZW50IGhhc2gsIHNpemUsIHRoZVxuICogc2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQsIGFuZCB0aGUgdmVyc2lvbidzIGxvZ2ljYWwgY2xvY2suIEVudHJpZXMgd2l0aFxuICogYGRlbGV0ZWRBdGAgc2V0IGFyZSB0b21ic3RvbmVzIFx1MjAxNCB0aGUgZmlsZSB3YXMgZGVsZXRlZCAobG9jYWxseSBvclxuICogcmVtb3RlbHkpIGJ1dCB0aGUgZW50cnkgc3RheXMgc28gdGhlIGRlbGV0aW9uIGlzIG5vdCByZXN1cnJlY3RlZCBieSB0aGVcbiAqIG5leHQgc2NhbiBhbmQgc28gcmVuYW1lIGNvcnJlbGF0aW9uIGtlZXBzIHdvcmtpbmcuXG4gKlxuICogVGhlIGluZGV4IGlzIHBlcnNpc3RlZCBpbnNpZGUgdGhlIHZhdWx0IGF0IGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWBcbiAqICh0aGF0IGRpcmVjdG9yeSBpcyBzeW5jLWlnbm9yZWQsIHNlZSBgaWdub3JlLnRzYCkgdGhyb3VnaCB0aGUgc3RvcmFnZVxuICogYWRhcHRlciwgd2hvc2UgYHdyaXRlRmlsZWAgaXMgYXRvbWljICh0ZW1wICsgcmVuYW1lKSBieSBjb250cmFjdC5cbiAqXG4gKiBBbGwgb3BlcmF0aW9ucyBhcmUgcHVyZTogdGhleSByZXR1cm4gbmV3IG9iamVjdHMgYW5kIG5ldmVyIG11dGF0ZSBpbnB1dHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKiBDdXJyZW50IG9uLWRpc2sgc2NoZW1hIHZlcnNpb24uIEJ1bXAgKyBhZGQgbWlncmF0aW9uIG9uIGJyZWFraW5nIGNoYW5nZXMuICovXG5leHBvcnQgY29uc3QgTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gPSAxO1xuXG4vKiogVmF1bHQgcGF0aCB3aGVyZSB0aGUgY2xpZW50IHBlcnNpc3RzIGl0cyBsb2NhbCBpbmRleC4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TVEFURV9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlJztcblxuLyoqIE9uZSBwYXRoJ3MgbGFzdC1rbm93bi1zeW5jZWQgc3RhdGUuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnRyeSB7XG4gIC8qKiBzaGEyNTYgaGV4IG9mIHRoZSBjb250ZW50IGF0IGB2ZXJzaW9uSWRgLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBDb250ZW50IHNpemUgaW4gYnl0ZXMgKGAwYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkIHRoaXMgZW50cnkgcmVmbGVjdHMuICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiBgdmVyc2lvbklkYCBcdTIwMTQgdXNlZCB0byBwcmVkaWN0IGNvbmZsaWN0IG91dGNvbWVzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkQXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyAoRlItMTApLiBGb2xkZXIgZW50cmllcyBjYXJyeVxuICAgKiBgaGFzaDogJydgLCBgc2l6ZTogMGA7IHRoZSBjbG9jayBpcyB0aGF0IG9mIHRoZSBwbGFjZWhvbGRlcidzIHZlcnNpb24uXG4gICAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgd2hvbGUgaW5kZXg6IG5vcm1hbGl6ZWQgdmF1bHQgcGF0aCBcdTIxOTIgZW50cnkuIGB7fWAgaXMgYSB2YWxpZCBlbXB0eSBpbmRleC4gKi9cbmV4cG9ydCB0eXBlIExvY2FsSW5kZXggPSBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+PjtcblxuLyoqIFZlcnNpb25lZCBzZXJpYWxpemF0aW9uIGVudmVsb3BlIChzY2hlbWFWZXJzaW9uIGVuYWJsZXMgZnV0dXJlIG1pZ3JhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnZlbG9wZSB7XG4gIHNjaGVtYVZlcnNpb246IG51bWJlcjtcbiAgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5Pjtcbn1cblxuLyoqIE9uZSBhdXRob3JpdGF0aXZlIHN0YXRlIGNoYW5nZSB0byBmb2xkIGludG8gdGhlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4Q29tbWl0IHtcbiAgcGF0aDogc3RyaW5nO1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUb21ic3RvbmUgdGhlIGVudHJ5IGluc3RlYWQgb2YgbWFya2luZyBpdCBsaXZlLiAqL1xuICBkZWxldGVkPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBkZWxldGlvbiBcdTIwMTQgcmVxdWlyZWQgd2hlbiBgZGVsZXRlZGAgaXMgdHJ1ZS4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIHRoaXMgY29tbWl0IHJlY29yZHMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBGb2xkIG9uZSBjb21taXQgaW50byB0aGUgaW5kZXguIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXgsIGlucHV0IHVudG91Y2hlZC5cbiAqXG4gKiBBcHBseWluZyBhIGNvbW1pdCBmb3IgYSBwYXRoIHJlcGxhY2VzIHRoYXQgcGF0aCdzIGVudHJ5IHdob2xlc2FsZSAoYSBjb21taXRcbiAqICppcyogdGhlIG5ldyB0cnV0aCBmb3IgdGhlIHBhdGgpOyBgYXBwbHlDb21taXRgIG5ldmVyIG1lcmdlcyBmaWVsZHMuXG4gKiBUb21ic3RvbmluZyAoYGRlbGV0ZWQ6IHRydWVgKSByZXF1aXJlcyBgZGVsZXRlZEF0YCBhbmQga2VlcHMgdGhlIGVudHJ5LlxuICpcbiAqIFRvIGRyb3AgYW4gZW50cnkgZW50aXJlbHkgKHRoZSBwYXRoIG1pZ3JhdGVkIGF3YXksIGUuZy4gYSBzeW5jZWQgcmVuYW1lKVxuICogdXNlIGByZW1vdmVFbnRyeWAgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q29tbWl0KGluZGV4OiBMb2NhbEluZGV4LCBjb21taXQ6IExvY2FsSW5kZXhDb21taXQpOiBMb2NhbEluZGV4IHtcbiAgaWYgKGNvbW1pdC5kZWxldGVkICYmIGNvbW1pdC5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBhcHBseUNvbW1pdDogdG9tYnN0b25lIGZvciAke0pTT04uc3RyaW5naWZ5KGNvbW1pdC5wYXRoKX0gcmVxdWlyZXMgZGVsZXRlZEF0YCxcbiAgICApO1xuICB9XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGNvbnN0IGVudHJ5OiBMb2NhbEluZGV4RW50cnkgPSB7XG4gICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgdmVyc2lvbklkOiBjb21taXQudmVyc2lvbklkLFxuICAgIGNsb2NrOiBjb21taXQuY2xvY2ssXG4gIH07XG4gIGlmIChjb21taXQuZGVsZXRlZCkgZW50cnkuZGVsZXRlZEF0ID0gY29tbWl0LmRlbGV0ZWRBdDtcbiAgaWYgKGNvbW1pdC5pc0ZvbGRlcikgZW50cnkuaXNGb2xkZXIgPSB0cnVlO1xuICBuZXh0W2NvbW1pdC5wYXRoXSA9IGVudHJ5O1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBSZW1vdmUgYSBwYXRoJ3MgZW50cnkgZW50aXJlbHkgKG5vIHRvbWJzdG9uZSkuIFVzZWQgd2hlbiB0aGUgYXV0aG9yaXR5XG4gKiBtaWdyYXRlcyBhIHBhdGgncyB2ZXJzaW9uIGNoYWluIGVsc2V3aGVyZSBcdTIwMTQgaS5lLiBhIHN5bmNlZCByZW5hbWU6IHRoZSBvbGRcbiAqIHBhdGggbXVzdCB2YW5pc2ggZnJvbSB0aGUgaW5kZXggZXhhY3RseSBhcyBpdCB2YW5pc2hlZCBmcm9tIHRoZSBtYW5pZmVzdC5cbiAqIFB1cmU7IHJlbW92aW5nIGFuIGFic2VudCBwYXRoIGlzIGEgbm8tb3AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVFbnRyeShpbmRleDogTG9jYWxJbmRleCwgcGF0aDogc3RyaW5nKTogTG9jYWxJbmRleCB7XG4gIGlmICghKHBhdGggaW4gaW5kZXgpKSByZXR1cm4gaW5kZXg7XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGRlbGV0ZSBuZXh0W3BhdGhdO1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBTZXJpYWxpemUgdG8gYSBkZXRlcm1pbmlzdGljIEpTT04gc3RyaW5nOiB2ZXJzaW9uZWQgZW52ZWxvcGUsIGVudHJpZXNcbiAqIHNvcnRlZCBieSBwYXRoIChzbyBpZGVudGljYWwgaW5kZXhlcyBzZXJpYWxpemUgYnl0ZS1pZGVudGljYWxseSBhbmQgZGlmZlxuICogY2xlYW5seSBpbiBzdGF0ZS1kaXIgbGlzdGluZ3MpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VyaWFsaXplTG9jYWxJbmRleChpbmRleDogTG9jYWxJbmRleCk6IHN0cmluZyB7XG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBwYXRoIG9mIE9iamVjdC5rZXlzKGluZGV4KS5zb3J0KCkpIHtcbiAgICBlbnRyaWVzW3BhdGhdID0gaW5kZXhbcGF0aF0gYXMgTG9jYWxJbmRleEVudHJ5O1xuICB9XG4gIGNvbnN0IGVudmVsb3BlOiBMb2NhbEluZGV4RW52ZWxvcGUgPSB7XG4gICAgc2NoZW1hVmVyc2lvbjogTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04sXG4gICAgZW50cmllcyxcbiAgfTtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGVudmVsb3BlKTtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHNlcmlhbGl6ZWQgaW5kZXggYmFjay4gVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCxcbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlLCBlbnRyaWVzIHdpdGggd3JvbmcgZmllbGQgdHlwZXMsIG9yIGEgYHNjaGVtYVZlcnNpb25gXG4gKiB0aGlzIGJ1aWxkIGRvZXMgbm90IHVuZGVyc3RhbmQgKG9sZGVyIG9yIG5ld2VyKS4gVW5rbm93biBleHRyYSBmaWVsZHMgYXJlXG4gKiB0b2xlcmF0ZWQgZm9yIGZvcndhcmQgY29tcGF0aWJpbGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplTG9jYWxJbmRleChqc29uOiBzdHJpbmcpOiBMb2NhbEluZGV4IHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGpzb24pO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgdmFsaWQgSlNPTicsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IGFuIG9iamVjdCcpO1xuICB9XG4gIGNvbnN0IHZlcnNpb24gPSBwYXJzZWQuc2NoZW1hVmVyc2lvbjtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcih2ZXJzaW9uKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBtaXNzaW5nIGludGVnZXIgc2NoZW1hVmVyc2lvbicpO1xuICB9XG4gIGlmICh2ZXJzaW9uICE9PSBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTikge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxuICAgICAgYExvY2FsIGluZGV4IHNjaGVtYSB2ZXJzaW9uICR7dmVyc2lvbn0gaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIGJ1aWxkIGAgK1xuICAgICAgICBgKGV4cGVjdGVkICR7TE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059KTsgYSBtaWdyYXRpb24gaXMgcmVxdWlyZWRgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgcmF3RW50cmllcyA9IHBhcnNlZC5lbnRyaWVzO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyB0aGUgZW50cmllcyBvYmplY3QnKTtcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBbcGF0aCwgcmF3XSBvZiBPYmplY3QuZW50cmllcyhyYXdFbnRyaWVzKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBwYXJzZUVudHJ5KHBhdGgsIHJhdyk7XG4gIH1cbiAgcmV0dXJuIGVudHJpZXM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRW50cnkocGF0aDogc3RyaW5nLCByYXc6IHVua25vd24pOiBMb2NhbEluZGV4RW50cnkge1xuICBjb25zdCB3aGVyZSA9IGBMb2NhbCBpbmRleCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KHBhdGgpfWA7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXcpKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gaXMgbm90IGFuIG9iamVjdGApO1xuICBjb25zdCB7IGhhc2gsIHNpemUsIHZlcnNpb25JZCwgY2xvY2ssIGRlbGV0ZWRBdCwgaXNGb2xkZXIgfSA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBoYXNoICE9PSAnc3RyaW5nJykgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiB2ZXJzaW9uSWQgbXVzdCBiZSBhIHN0cmluZ2ApO1xuICB9XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIoc2l6ZSkgfHwgc2l6ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IHNpemUgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyYCk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGNsb2NrKSB8fCB0eXBlb2YgY2xvY2suY291bnRlciAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGNsb2NrLmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogY2xvY2sgbXVzdCBiZSB7IGNvdW50ZXI6IG51bWJlciwgZGV2aWNlSWQ6IHN0cmluZyB9YCk7XG4gIH1cbiAgaWYgKGRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBkZWxldGVkQXQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZWxldGVkQXQgbXVzdCBiZSBhIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBpZiAoaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaXNGb2xkZXIgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkLFxuICAgIGNsb2NrOiB7IGNvdW50ZXI6IGNsb2NrLmNvdW50ZXIgYXMgbnVtYmVyLCBkZXZpY2VJZDogY2xvY2suZGV2aWNlSWQgYXMgc3RyaW5nIH0sXG4gIH07XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgZW50cnkuZGVsZXRlZEF0ID0gZGVsZXRlZEF0IGFzIG51bWJlcjtcbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQpIGVudHJ5LmlzRm9sZGVyID0gaXNGb2xkZXIgYXMgYm9vbGVhbjtcbiAgcmV0dXJuIGVudHJ5O1xufVxuXG5mdW5jdGlvbiBpc1BsYWluT2JqZWN0KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG4iLCAiLyoqXG4gKiBUaGluIHB1bGwtc2lkZSBvcmNoZXN0cmF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDUpLiBOT1QgdGhlIG5ldHdvcmtcbiAqIGNsaWVudDogYWxsIHRyYW5zcG9ydCBpcyBpbmplY3RlZCAoYGZldGNoQmxvYmApLCB3aGljaCB0aGUgbGF0ZXIgbmV0d29ya1xuICogcGhhc2UgaW1wbGVtZW50cyBvdmVyIGAvYmxvYi86aGFzaGAgb3IgV1MtaW5saW5lIGNvbnRlbnQuXG4gKlxuICogYGFwcGx5UHVsbGAgbWF0ZXJpYWxpemVzIGV2ZXJ5IGBQdWxsT3BgIG9mIGEgYFN5bmNQbGFuYCB0aHJvdWdoIHRoZVxuICogc3RvcmFnZSBhZGFwdGVyIGFuZCB1cGRhdGVzIHRoZSBsb2NhbCBpbmRleCBcdTIwMTQgZHVyYWJseSBhbmQgaG9uZXN0bHk6XG4gKlxuICogICAtIGJsb2JzIGFyZSB2ZXJpZmllZCAoc2hhMjU2KSBiZWZvcmUgYmVpbmcgd3JpdHRlbjsgYSBtaXNtYXRjaCBhYm9ydHNcbiAqICAgICB0aGUgcGxhbjtcbiAqICAgLSBlYWNoIGluZGV4IGVudHJ5IGlzIHJlY29yZGVkIG9ubHkgKmFmdGVyKiBpdHMgc3RvcmFnZSB3cml0ZSBzdWNjZWVkZWQsXG4gKiAgICAgc28gYSBtaWQtcGxhbiBmYWlsdXJlIGxlYXZlcyB0aGUgaW5kZXggZGVzY3JpYmluZyBleGFjdGx5IHRoZSBmaWxlc1xuICogICAgIHRoYXQgYWN0dWFsbHkgbGFuZGVkIChGUi01OiBub3RoaW5nIGlzIHNpbGVudGx5IGxvc3QgXHUyMDE0IHRoZSB1bnN5bmNlZFxuICogICAgIHB1bGxzIHNpbXBseSByZW1haW4gaW4gdGhlIHBsYW4gYW5kIGFyZSByZXRyaWVkIGJ5IHRoZSBjYWxsZXIpO1xuICogICAtIHRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgdGhyb3VnaCB0aGUgYWRhcHRlcidzIGF0b21pYyBgd3JpdGVGaWxlYFxuICogICAgICh0ZW1wICsgcmVuYW1lIHBlciB0aGUgYWRhcHRlciBjb250cmFjdCkgYXRcbiAqICAgICBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgLCBpbmNsdWRpbmcgb24gdGhlIGZhaWx1cmUgcGF0aC5cbiAqXG4gKiBQdXNoZXMvY29uZmxpY3RzL2ZvbGRlciBvcHMgYXJlIHRoZSBuZXR3b3JrIHBoYXNlJ3MgYnVzaW5lc3M7IHJldHJ5XG4gKiBxdWV1ZXMgYXJlIGV4cGxpY2l0bHkgb3V0IG9mIHNjb3BlIGhlcmUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gIHJlbW92ZUVudHJ5LFxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxuICB0eXBlIExvY2FsSW5kZXgsXG59IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgdHlwZSB7IFB1bGxPcCwgU3luY1BsYW4gfSBmcm9tICcuL3Jlc29sdmUuanMnO1xuXG4vKiogSW5qZWN0ZWQgY29udGVudCB0cmFuc3BvcnQ6IGZldGNoIHRoZSBibG9iIGZvciBhIGNvbnRlbnQgaGFzaC4gKi9cbmV4cG9ydCB0eXBlIEZldGNoQmxvYiA9IChoYXNoOiBzdHJpbmcpID0+IFByb21pc2U8VWludDhBcnJheT47XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQdWxsT3B0aW9ucyB7XG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciB0b21ic3RvbmUgdGltZXN0YW1wcy4gRGVmYXVsdDogYERhdGUubm93KClgIFx1MjAxNCB0aGlzXG4gICAqICBmdW5jdGlvbiBpcyBJL08gb3JjaGVzdHJhdGlvbiwgbm90IGEgcHVyZSBmdW5jdGlvbiwgYnV0IHRlc3RzIGluamVjdFxuICAgKiAgYSBmaXhlZCB2YWx1ZSBmb3IgZGV0ZXJtaW5pc20uICovXG4gIG5vdz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBcHBseSBhbGwgcHVsbHMgb2YgYHBsYW5gIGFuZCByZXR1cm4gdGhlIHVwZGF0ZWQgaW5kZXggKGFsc28gcGVyc2lzdGVkIHRvXG4gKiB0aGUgYWRhcHRlciBhdCBgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSGApLlxuICpcbiAqIFN0b3JhZ2Ugd3JpdGVzIGhhcHBlbiBpbiBwbGFuIG9yZGVyLiBJZiBhbnkgb3AgZmFpbHMsIHRoZSBpbmRleCByZWZsZWN0aW5nXG4gKiBldmVyeSBvcCB0aGF0IHN1Y2NlZWRlZCBzbyBmYXIgaXMgcGVyc2lzdGVkIGFuZCB0aGUgb3JpZ2luYWwgZXJyb3IgaXNcbiAqIHJldGhyb3duIFx1MjAxNCBwYXRocyB0aGF0IGZhaWxlZCBhcmUgYWJzZW50IGZyb20gdGhlIHJldHVybmVkL3BlcnNpc3RlZCBpbmRleC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5UHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwbGFuOiBTeW5jUGxhbixcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4gIG9wdGlvbnM6IEFwcGx5UHVsbE9wdGlvbnMgPSB7fSxcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyBEYXRlLm5vdygpO1xuICBsZXQgd29ya2luZzogTG9jYWxJbmRleCA9IGluZGV4O1xuXG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHBsYW4ucHVsbHMpIHtcbiAgICAgIHdvcmtpbmcgPSBhd2FpdCBhcHBseU9uZVB1bGwoc3RvcmFnZSwgd29ya2luZywgcHVsbCwgZmV0Y2hCbG9iLCBub3cpO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGVyc2lzdGVuY2UgZmFpbHVyZSBtdXN0IG5vdCBtYXNrIHRoZSBvcmlnaW5hbCBlcnJvcjsgdGhlIGNhbGxlclxuICAgICAgLy8gcmV0cmllcyB0aGUgd2hvbGUgY3ljbGUgYW55d2F5LlxuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nKTtcbiAgcmV0dXJuIHdvcmtpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5T25lUHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwdWxsOiBQdWxsT3AsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuICBub3c6IG51bWJlcixcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBpZiAocHVsbC5raW5kID09PSAncmVuYW1lJykge1xuICAgIGlmIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLmZyb21QYXRoKSkge1xuICAgICAgYXdhaXQgc3RvcmFnZS5yZW5hbWVGaWxlKHB1bGwuZnJvbVBhdGgsIHB1bGwudG9QYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT2xkIHBhdGggbmV2ZXIgbWF0ZXJpYWxpemVkIGhlcmUgKG9yIGFscmVhZHkgbW92ZWQpOiBmZXRjaCBjb250ZW50LlxuICAgICAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnRvUGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICAgIH1cbiAgICByZXR1cm4gYXBwbHlDb21taXQocmVtb3ZlRW50cnkoaW5kZXgsIHB1bGwuZnJvbVBhdGgpLCB7XG4gICAgICBwYXRoOiBwdWxsLnRvUGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBpZiAocHVsbC5pc0ZvbGRlcikge1xuICAgIC8vIEZvbGRlciBwbGFjZWhvbGRlcnMgKEZSLTEwKTogY3JlYXRlIHRoZSBkaXJlY3RvcnksIHJlY29yZCB0aGUgZW50cnkuXG4gICAgLy8gVG9tYnN0b25lZCBwbGFjZWhvbGRlcnMgcmVjb3JkIG9ubHkgXHUyMDE0IGRlbGV0aW5nIGEgZGlyZWN0b3J5IGZyb20gc3RvcmFnZVxuICAgIC8vIChhbmQgY2FzY2FkaW5nIHRvIGFueSBmaWxlcyBwbGFjZWQgaW5zaWRlIGl0KSBpcyBhIHBsYXRmb3JtIGNvbmNlcm4uXG4gICAgaWYgKCFwdWxsLmRlbGV0ZWQpIGF3YWl0IHN0b3JhZ2UuZW5zdXJlRGlyKHB1bGwucGF0aCk7XG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogcHVsbC5kZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBwdWxsLmRlbGV0ZWQgPyBub3cgOiB1bmRlZmluZWQsXG4gICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChwdWxsLmRlbGV0ZWQpIHtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdDsgYSBsb2NhbCAudHJhc2ggY29weSBpcyBhXG4gICAgLy8gcGxhdGZvcm0tbGF5ZXIgY29uY2VybiAoZGFlbW9uL3BsdWdpbiksIG5vdCBlbmdpbmUgbG9naWMuXG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKHB1bGwucGF0aCk7XG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgIGRlbGV0ZWRBdDogbm93LFxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgY3VycmVudCA9IGluZGV4W3B1bGwucGF0aF07XG4gIGlmIChcbiAgICBjdXJyZW50ICE9PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgY3VycmVudC5oYXNoID09PSBwdWxsLmhhc2ggJiZcbiAgICAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5wYXRoKSlcbiAgKSB7XG4gICAgLy8gQ29udGVudCBhbHJlYWR5IGNvcnJlY3QgbG9jYWxseSAoZS5nLiB2ZXJzaW9uLWlkIGNhdGNoLXVwIGFmdGVyIGFcbiAgICAvLyByZW5hbWUgZWxzZXdoZXJlKTogcmVjb3JkIHRoZSBhdXRob3JpdGF0aXZlIGhlYWQsIHNraXAgZmV0Y2grd3JpdGUuXG4gICAgLy8gVGhlIGV4aXN0ZW5jZSBjaGVjayBtYXR0ZXJzIHdoZW4gdGhlIGZpbGUgd2FzIGRlbGV0ZWQgbG9jYWxseSBzaW5jZSB0aGVcbiAgICAvLyBpbmRleCB3YXMgbGFzdCB3cml0dGVuIFx1MjAxNCByZWNyZWF0aW5nIGl0IGlzIHdoYXQgdGhlIHB1bGwgZGVtYW5kcy5cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwucGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgaGFzaDogcHVsbC5oYXNoLFxuICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgfSk7XG59XG5cbi8qKiBEb3dubG9hZCwgdmVyaWZ5LCBhbmQgd3JpdGUgb25lIGJsb2IuIEEgaGFzaCBtaXNtYXRjaCBhYm9ydHMgdGhlIHBsYW4uICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFZlcmlmaWVkKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgcGF0aDogc3RyaW5nLFxuICBoYXNoOiBzdHJpbmcsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGJ5dGVzID0gYXdhaXQgZmV0Y2hCbG9iKGhhc2gpO1xuICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICBpZiAoYWN0dWFsICE9PSBoYXNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEJsb2IgaGFzaCBtaXNtYXRjaCBmb3IgJHtKU09OLnN0cmluZ2lmeShwYXRoKX06IGV4cGVjdGVkICR7aGFzaH0sIGdvdCAke2FjdHVhbH1gLFxuICAgICk7XG4gIH1cbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUocGF0aCwgYnl0ZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwZXJzaXN0SW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsIGluZGV4OiBMb2NhbEluZGV4KTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXgpKSxcbiAgKTtcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggZnJvbSBzdG9yYWdlIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBzdGVwIDEpLiBUaHJvd3NcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcbiAqIHN0YXRlIFx1MjAxNCBjYWxsZXJzIHN1cmZhY2UgdGhhdCBpbnN0ZWFkIG9mIHNpbGVudGx5IHJlLXN5bmNpbmcgZnJvbSBzY3JhdGNoLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsSW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpO1xuICByZXR1cm4gZGVzZXJpYWxpemVMb2NhbEluZGV4KG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShieXRlcykpO1xufVxuIiwgIi8qKlxuICogVmF1bHQgaWdub3JlIHJ1bGVzIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCwgRlItMTEvRlItNDIpIFx1MjAxNCBzaGFyZWQgYnkgZXZlcnlcbiAqIGNsaWVudCBzbyBsb2NhbCBzY2Fucywgd2F0Y2hlcnMsIGFuZCBjb21taXQgcGF0aHMgYWdyZWUgYnl0ZS1mb3ItYnl0ZS5cbiAqXG4gKiBNYXRjaGluZyBpcyBzZWdtZW50LWJhc2VkIGFuZCBjYXNlLWluc2Vuc2l0aXZlICh0aGUgb3duZXIncyBwcmltYXJ5XG4gKiBwbGF0Zm9ybXMgXHUyMDE0IFdpbmRvd3MsIG1hY09TIFx1MjAxNCBoYXZlIGNhc2UtaW5zZW5zaXRpdmUgZmlsZXN5c3RlbXMsIHNvXG4gKiBgLlRyYXNoL2Zvby5tZGAgbXVzdCBub3Qgc25lYWsgcGFzdCB0aGUgYC50cmFzaC9gIHJ1bGUpLlxuICovXG5cbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogU2V0dGluZ3Mgc3Vic2V0IGBpc0lnbm9yZWRgIG5lZWRzOyBgVmF1bHRTZXR0aW5nc2Agc2F0aXNmaWVzIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVTZXR0aW5ncyB7XG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYW5kIGAub2JzaWRpYW4vY2FjaGUvYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSWdub3JlZCh2YXVsdFBhdGg6IHN0cmluZywgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzKTogYm9vbGVhbiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGxvd2VyID0gbm9ybWFsaXplZC5zbGljZSgxKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBzZWdtZW50cyA9IGxvd2VyLnNwbGl0KCcvJyk7XG5cbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IEFMV0FZU19JR05PUkVEX1NFR01FTlRTLmhhcyhzZWdtZW50KSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlmIChzZWdtZW50c1swXSA9PT0gJy5vYnNpZGlhbicpIHtcbiAgICBpZiAoIXNldHRpbmdzLm9ic2lkaWFuU3luYykgcmV0dXJuIHRydWU7XG4gICAgaWYgKE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTLmhhcyhsb3dlcikpIHJldHVybiB0cnVlO1xuICAgIGlmIChzZWdtZW50c1sxXSA9PT0gJ2NhY2hlJykgcmV0dXJuIHRydWU7IC8vIHRoZSBkaXIgaXRzZWxmIGFuZCBhbnl0aGluZyB1bmRlciBpdFxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8qKlxuICogVHlwZWQgV2ViU29ja2V0IG1lc3NhZ2UgZGVmaW5pdGlvbnMgZm9yIHRoZSBgL3N5bmNgIGNoYW5uZWxcbiAqIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NSkuIEFsbCBtZXNzYWdlcyBhcmUgSlNPTiB3aXRoIGEgYHR5cGVgIGRpc2NyaW1pbmFudC5cbiAqXG4gKiBUd28gY2hhbm5lbHMgZXhpc3Q6IHRoaXMgV1MgcHJvdG9jb2wgKG1ldGFkYXRhICsgY2hhbmdlIGZlZWQpIGFuZCBwbGFpblxuICogSFRUUFMgYmxvYiByb3V0ZXMgKGBHRVQvUFVUIC9ibG9iLzpoYXNoYCkgZm9yIGNvbnRlbnQgXHUyMDE0IHJlZmVyZW5jZWQgaGVyZVxuICogb25seSB2aWEgY29udGVudCBoYXNoZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2ssIFZlcnNpb24sIFZlcnNpb25LaW5kLCBWYXVsdFNldHRpbmdzIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKiogV2lyZSBwcm90b2NvbCB2ZXJzaW9uLiBCdW1wIG9uIGJyZWFraW5nIG1lc3NhZ2Utc2hhcGUgY2hhbmdlcy4gKi9cbmV4cG9ydCBjb25zdCBQcm90b2NvbFZlcnNpb24gPSAxIGFzIGNvbnN0O1xuXG4vKiogQ29tbWl0cyBhdCBvciBiZWxvdyB0aGlzIHNpemUgbWF5IGlubGluZSBjb250ZW50IChiYXNlNjQpIG9uIHRoZSBXUy4gKi9cbmV4cG9ydCBjb25zdCBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMgPSAyNTYgKiAxMDI0O1xuXG4vKipcbiAqIE9uZSBlbnRyeSBvZiB0aGUgbWFuaWZlc3QgbWFwIChge3BhdGggXHUyMTkyIE1hbmlmZXN0RW50cnl9YCkuIFRoZSBlbnRyeSBpc1xuICogc2VsZi1kZXNjcmliaW5nOiBpdCBjYXJyaWVzIGl0cyBvd24gYHBhdGhgIGFuZCB0aGUgaGVhZCdzIGBjbG9ja2Agc28gdGhlXG4gKiBjbGllbnQtc2lkZSByZWNvbmNpbGlhdGlvbiAoYHJlc29sdmUudHNgKSBjYW4gb3JkZXIgcmVtb3RlIHN0YXRlIGFnYWluc3RcbiAqIGxvY2FsIHN0YXRlIHdpdGhvdXQgYW55IGV4dHJhIHJvdW5kLXRyaXBzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0RW50cnkge1xuICAvKiogTm9ybWFsaXplZCB2YXVsdCBwYXRoIHRoaXMgZW50cnkgZGVzY3JpYmVzIChtaXJyb3JzIHRoZSBtYXAga2V5KS4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCBvZiB0aGUgZW50cnkncyBoZWFkLiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIC8qKiBzaGEyNTYgaGV4IG9mIGN1cnJlbnQgY29udGVudCAoYCcnYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVG9tYnN0b25lIGZsYWcuICovXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBoZWFkIFx1MjAxNCB0aGUgb3JkZXJpbmcgYXV0aG9yaXR5IChcdTAwQTc0KS4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIGxhc3QgdXBkYXRlLCBkaXNwbGF5LW9ubHkuICovXG4gIG10aW1lOiBudW1iZXI7XG59XG5cbi8vIC0tLSBDbGllbnQgXHUyMTkyIFNlcnZlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBdXRoICsgY2F0Y2gtdXA6IHRva2VuLCBwcm90b2NvbCB2ZXJzaW9uLCBsYXN0IHNlZW4gRE8gc2VxdWVuY2UgbnVtYmVyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBIZWxsb01lc3NhZ2Uge1xuICB0eXBlOiAnaGVsbG8nO1xuICB0b2tlbjogc3RyaW5nO1xuICBwcm90b2NvbFZlcnNpb246IG51bWJlcjtcbiAgLyoqIExhc3Qgc2VlbiBnbG9iYWwgc2VxdWVuY2UgbnVtYmVyOyAwIGZvciBhIGZpcnN0LWV2ZXIgY29ubmVjdC4gKi9cbiAgY3Vyc29yOiBudW1iZXI7XG59XG5cbi8qKiBSZXF1ZXN0IGZ1bGwgKGBzaW5jZWAgb21pdHRlZCkgb3IgZGVsdGEgbWFuaWZlc3QuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldE1hbmlmZXN0TWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRNYW5pZmVzdCc7XG4gIHNpbmNlPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbW1pdCBhIG5ldyB2ZXJzaW9uLiBJZiBgaW5saW5lYCBpcyBzZXQgaXQgY2FycmllcyB0aGUgZnVsbCBjb250ZW50XG4gKiBiYXNlNjQtZW5jb2RlZCAob25seSBhbGxvd2VkIHdoZW4gYHNpemUgPD0gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTYCk7XG4gKiBvdGhlcndpc2UgdGhlIGJsb2IgbXVzdCBhbHJlYWR5IGJlIHVwbG9hZGVkIChgcHV0QmxvYmAgb24gdGhpcyBjaGFubmVsLFxuICogYFBVVCAvYmxvYi86aGFzaGAgb24gdGhlIHJlYWwgd29ya2VyKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21taXRNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbW1pdCc7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGNvbW1pdCBidWlsZHMgb247IHNlcnZlciBkZXRlY3RzIGRpdmVyZ2VuY2UgXHUyMTkyIGNvbmZsaWN0LiAqL1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFdoYXQga2luZCBvZiB2ZXJzaW9uIHRoaXMgY29tbWl0cyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXG4gIGtpbmQ6IFZlcnNpb25LaW5kO1xuICBpbmxpbmU/OiBzdHJpbmc7XG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcmVxdWlyZWQgZm9yIGBraW5kOiAncmVuYW1lJ2AgKGNoYWluIG1pZ3JhdGlvbiwgRlItOSkuICovXG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGNvbW1pdHMgKEZSLTEwOyBoYXNoIGAnJ2AsIHNpemUgMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEtlZXBhbGl2ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGluZ01lc3NhZ2Uge1xuICB0eXBlOiAncGluZyc7XG4gIC8qKiBDbGllbnQgZXBvY2ggbXM7IGVjaG9lZCBiYWNrIG9uIGBwb25nYCBmb3IgUlRUIC8gc2tldyBtZWFzdXJlbWVudC4gKi9cbiAgdHM/OiBudW1iZXI7XG59XG5cbi8qKlxuICogVXBsb2FkIGEgY29udGVudCBibG9iIG92ZXIgdGhlIHN5bmMgY2hhbm5lbC4gVGVzdCBkb3VibGVzIGFuZCBzbWFsbCB2YXVsdHNcbiAqIGNhbiB1c2UgdGhpcyBkaXJlY3RseTsgdGhlIHJlYWwgd29ya2VyIGV4cG9zZXMgdGhlIHNhbWUgb3BlcmF0aW9uIGFzXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCAoc3RyZWFtZWQpLiBJZGVtcG90ZW50OiBzYW1lIGhhc2ggXHUyMUQyIHNhbWUgY29udGVudC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdwdXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cbiAgY29udGVudDogc3RyaW5nO1xufVxuXG4vKiogRmV0Y2ggYSBjb250ZW50IGJsb2IgKHRoZSBXUy1pbmxpbmUgcGF0aCBvZiBcdTAwQTc4IFwiZmV0Y2ggYmxvYlwiKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmxvYk1lc3NhZ2Uge1xuICB0eXBlOiAnZ2V0QmxvYic7XG4gIGhhc2g6IHN0cmluZztcbn1cblxuLy8gLS0tIFNlcnZlciBcdTIxOTIgQ2xpZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN1Y2Nlc3NmdWwgaGVsbG86IHRoaXMgZGV2aWNlJ3MgaWRlbnRpdHkgKyB2YXVsdC1sZXZlbCBpbmZvLiAqL1xuZXhwb3J0IGludGVyZmFjZSBIZWxsb0Fja01lc3NhZ2Uge1xuICB0eXBlOiAnaGVsbG9BY2snO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICB2YXVsdE5hbWU6IHN0cmluZztcbiAgc2V0dGluZ3M6IFZhdWx0U2V0dGluZ3M7XG59XG5cbi8qKiBSZXBseSB0byBgZ2V0TWFuaWZlc3RgOiB0aGUgKHBvc3NpYmx5IGRlbHRhKSBmaWxlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdE1lc3NhZ2Uge1xuICB0eXBlOiAnbWFuaWZlc3QnO1xuICBlbnRyaWVzOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdEVudHJ5Pj47XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIHRoaXMgbWFuaWZlc3QgcmVmbGVjdHMgKGN1cnNvciBjYXRjaC11cCkuICovXG4gIGN1cnNvcjogbnVtYmVyO1xufVxuXG4vKiogQ29tbWl0IGFjY2VwdGVkIGFzIHRoZSBuZXcgaGVhZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0QWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdjb21taXRBY2snO1xuICAvKiogVmVyc2lvbiBpZCBhc3NpZ25lZCBieSB0aGUgYXV0aG9yaXR5LiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBhY2NlcHRlZCB2ZXJzaW9uLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgYWNjZXB0ZWQgaGVhZCAoY3Vyc29yIHRyYWNraW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBXaGF0IGhhcHBlbmVkIHRvIHRoZSBsb3Npbmcgc2lkZSBvZiBhIGNvbmN1cnJlbnQgZWRpdCAoc2VlIGRpc3Bvc2l0aW9uKS4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbiA9ICdjb25mbGljdENvcHknO1xuXG4vKiogQ29tbWl0IGxvc3QgdGhlIHJhY2U7IHRoZSBzZXJ2ZXIncyBjaG9zZW4gd2lubmVyIHN0YW5kcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbmZsaWN0JztcbiAgLyoqIFRoZSB3aW5uaW5nIHZlcnNpb24gKHRoaXMgY29tbWl0IG9yIHRoZSBjb25jdXJyZW50IG9uZSkuICovXG4gIHdpbm5lcjogVmVyc2lvbjtcbiAgLyoqIFdoYXQgdGhlIHNlcnZlciBkaWQgd2l0aCB0aGUgbG9zZXIncyBjb250ZW50IFx1MjAxNCBuZXZlciBkZWxldGVkLiAqL1xuICBsb3NlckRpc3Bvc2l0aW9uOiBDb25mbGljdExvc2VyRGlzcG9zaXRpb247XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSB3aW5uaW5nIGhlYWQsIHdoZW4gaXQgaGFzIG9uZS4gKi9cbiAgc2VxPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEZhbi1vdXQgcGF5bG9hZCBzaGFyZWQgYnkgdGhlIGNoYW5nZSBicm9hZGNhc3QgYW5kIHRoZSBhcmJpdHJhdGlvbiByZXN1bHQuXG4gKiBFdmVyeXRoaW5nIGEgY2xpZW50IG5lZWRzIHRvIG1hdGVyaWFsaXplIG9uZSBoZWFkIHRyYW5zaXRpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlUGF5bG9hZCB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIG5ldyBoZWFkLiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogSWQgb2YgdGhlIGRldmljZSB0aGF0IGNvbW1pdHRlZC4gKi9cbiAgZGV2aWNlOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBuZXcgaGVhZCBcdTIwMTQgY2xpZW50cyB1c2UgaXQgdG8gc2tpcCBzdGFsZSByZXBsYXlzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogV2hhdCBraW5kIG9mIGNoYW5nZSB0aGlzIGlzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcHJlc2VudCB3aGVuIGBraW5kOiAncmVuYW1lJ2AuICovXG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgZm9sZGVyIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogRmFuLW91dCBicm9hZGNhc3QgdG8gYWxsICpvdGhlciogY29ubmVjdGVkIGNsaWVudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZU1lc3NhZ2UgZXh0ZW5kcyBDaGFuZ2VQYXlsb2FkIHtcbiAgdHlwZTogJ2NoYW5nZSc7XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoaXMgY2hhbmdlIChjdXJzb3IgdHJhY2tpbmcpLiAqL1xuICBzZXE6IG51bWJlcjtcbn1cblxuLyoqIFJlcGx5IHRvIGBwdXRCbG9iYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYkFja01lc3NhZ2Uge1xuICB0eXBlOiAnYmxvYkFjayc7XG4gIGhhc2g6IHN0cmluZztcbn1cblxuLyoqIFJlcGx5IHRvIGBnZXRCbG9iYDogdGhlIHJlcXVlc3RlZCBjb250ZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdibG9iJztcbiAgaGFzaDogc3RyaW5nO1xuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cbiAgY29udGVudDogc3RyaW5nO1xufVxuXG4vKiogTWFjaGluZS1yZWFkYWJsZSBjb2RlcyBjYXJyaWVkIGJ5IGBlcnJvcmAgbWVzc2FnZXMgKEhUVFAtZXF1aXZhbGVudCkuICovXG5leHBvcnQgdHlwZSBTZXJ2ZXJFcnJvckNvZGUgPSAnVU5BVVRIT1JJWkVEJyB8ICdSRVZPS0VEJyB8ICdOT1RfRk9VTkQnIHwgJ1BST1RPQ09MJztcblxuLyoqIE5lZ2F0aXZlIHJlcGx5IChhdXRoIGZhaWx1cmUsIHVua25vd24gYmxvYiwgcHJvdG9jb2wgdmlvbGF0aW9uLCBcdTIwMjYpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFcnJvck1lc3NhZ2Uge1xuICB0eXBlOiAnZXJyb3InO1xuICBjb2RlOiBTZXJ2ZXJFcnJvckNvZGU7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqIFByZXNlbmNlIHVwZGF0ZSBmb3IgZGFzaGJvYXJkcyAvIGB2c2Egc3RhdHVzYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlU2Vlbk1lc3NhZ2Uge1xuICB0eXBlOiAnZGV2aWNlU2Vlbic7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIHRzOiBudW1iZXI7XG59XG5cbi8qKiBLZWVwYWxpdmUgcmVwbHkuICovXG5leHBvcnQgaW50ZXJmYWNlIFBvbmdNZXNzYWdlIHtcbiAgdHlwZTogJ3BvbmcnO1xuICAvKiogRWNob2VzIHRoZSBgcGluZ2AgdHMgd2hlbiBvbmUgd2FzIHByb3ZpZGVkLiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLy8gLS0tIFVuaW9uICsgZ3VhcmRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBDbGllbnRNZXNzYWdlID1cbiAgfCBIZWxsb01lc3NhZ2VcbiAgfCBHZXRNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRNZXNzYWdlXG4gIHwgUHV0QmxvYk1lc3NhZ2VcbiAgfCBHZXRCbG9iTWVzc2FnZVxuICB8IFBpbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBTZXJ2ZXJNZXNzYWdlID1cbiAgfCBIZWxsb0Fja01lc3NhZ2VcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRBY2tNZXNzYWdlXG4gIHwgQ29uZmxpY3RNZXNzYWdlXG4gIHwgQ2hhbmdlTWVzc2FnZVxuICB8IERldmljZVNlZW5NZXNzYWdlXG4gIHwgQmxvYkFja01lc3NhZ2VcbiAgfCBCbG9iTWVzc2FnZVxuICB8IEVycm9yTWVzc2FnZVxuICB8IFBvbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBNZXNzYWdlID0gQ2xpZW50TWVzc2FnZSB8IFNlcnZlck1lc3NhZ2U7XG5cbmNvbnN0IENMSUVOVF9UWVBFUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnaGVsbG8nLFxuICAnZ2V0TWFuaWZlc3QnLFxuICAnY29tbWl0JyxcbiAgJ3B1dEJsb2InLFxuICAnZ2V0QmxvYicsXG4gICdwaW5nJyxcbl0pO1xuY29uc3QgU0VSVkVSX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdoZWxsb0FjaycsXG4gICdtYW5pZmVzdCcsXG4gICdjb21taXRBY2snLFxuICAnY29uZmxpY3QnLFxuICAnY2hhbmdlJyxcbiAgJ2RldmljZVNlZW4nLFxuICAnYmxvYkFjaycsXG4gICdibG9iJyxcbiAgJ2Vycm9yJyxcbiAgJ3BvbmcnLFxuXSk7XG5cbi8qKlxuICogUnVudGltZSBzaGFwZSBjaGVjazogYSB2YWx1ZSBpcyBhIGBNZXNzYWdlYCBpZmYgaXQgaXMgYW4gb2JqZWN0IHdob3NlXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cbiAqIGJvdGggV1MgZW5kcyBjYW4gdHJpYWdlIHVua25vd24vZm9yd2FyZC1jb21wYXRpYmxlIHR5cGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgPT09ICdzdHJpbmcnICYmXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ2xpZW50TWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIENsaWVudE1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxuICApO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxuICogVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCBvciB1bmtub3duIG1lc3NhZ2UgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNNZXNzYWdlKHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLy8gLS0tIHdpcmUgZW5jb2RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gYGlubGluZWAvYGNvbnRlbnRgIGZpZWxkcyBjYXJyeSByYXcgYnl0ZXMgYXMgYmFzZTY0LiBgYnRvYWAvYGF0b2JgIGV4aXN0IGluXG4vLyBldmVyeSB0YXJnZXQgcnVudGltZSAoV29ya2VycywgTm9kZSAxNissIEVsZWN0cm9uKTsgY2h1bmtpbmcgYXZvaWRzXG4vLyBleGNlZWRpbmcgYXJndW1lbnQtbGVuZ3RoIGxpbWl0cyBvbiBsYXJnZSBhdHRhY2htZW50cy5cblxuLyoqIEVuY29kZSBieXRlcyBhcyBiYXNlNjQuICovXG5leHBvcnQgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IGJ5dGVzLmxlbmd0aDsgb2Zmc2V0ICs9IENIVU5LKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBDSFVOSykpO1xuICB9XG4gIHJldHVybiBidG9hKGJpbmFyeSk7XG59XG5cbi8qKiBEZWNvZGUgYmFzZTY0IHRvIGJ5dGVzLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIGludmFsaWQgaW5wdXQuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhlbmNvZGVkOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgbGV0IGJpbmFyeTogc3RyaW5nO1xuICB0cnkge1xuICAgIGJpbmFyeSA9IGF0b2IoZW5jb2RlZCk7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0Jhc2U2NCBwYXlsb2FkIGlzIG5vdCB2YWxpZCcsIHsgY2F1c2UgfSk7XG4gIH1cbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW5hcnkubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluYXJ5LmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBieXRlcztcbn1cbiIsICIvKipcbiAqIENvbmZsaWN0LWNvcHkgZmlsZSBuYW1pbmcgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi02KS5cbiAqXG4gKiBXaGVuIGEgZGV2aWNlIGxvc2VzIGEgY29uZmxpY3QgYnV0IGl0cyBjb250ZW50IG11c3QgYmUgcHJlc2VydmVkLCB0aGVcbiAqIGNvbnRlbnQgaXMgY29tbWl0dGVkIHRvIGEgc2libGluZyBcImNvbmZsaWN0IGNvcHlcIiBwYXRoIHNoYXBlZCBsaWtlOlxuICpcbiAqICAgICBOb3RlIChjb25mbGljdCAyMDI2LTA4LTIwIDE0LTIzIC0gZnJvbSBQaG9uZSkubWRcbiAqICAgICBcdTI1MTRcdTI1MDAgc3RlbSBcdTI1MDBcdTI1MThcdTI1MTRcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgVVRDIGRhdGUgKyBISC1tbSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MThcdTI1MTQgZGV2aWNlIFx1MjUxOFx1MjUxNGV4dFx1MjUxOFxuICpcbiAqIFJ1bGVzOlxuICogICAtIHRpbWVzdGFtcCBpcyBhbHdheXMgVVRDIChuZXZlciBhIGxvY2FsIHRpbWV6b25lKSBzbyBldmVyeSBjbGllbnRcbiAqICAgICBjb21wdXRlcyB0aGUgaWRlbnRpY2FsIG5hbWUgZnJvbSB0aGUgc2FtZSBjb21taXQgdGltZTtcbiAqICAgLSB0aGUgZGV2aWNlIG5hbWUgaXMgc2FuaXRpemVkIGZvciBmaWxlc3lzdGVtIHNhZmV0eSAoc2VlXG4gKiAgICAgYHNhbml0aXplRGV2aWNlTmFtZWApO1xuICogICAtIHRoZSBvcmlnaW5hbCBleHRlbnNpb24gaXMgcHJlc2VydmVkIChsYXN0IGRvdCBpbiB0aGUgYmFzZW5hbWUsIGFzIGxvbmdcbiAqICAgICBhcyBpdCBpcyBub3QgdGhlIGZpcnN0IGNoYXJhY3RlciBcdTIwMTQgYC5naXRpZ25vcmVgIGhhcyBubyBleHRlbnNpb24pO1xuICogICAtIGlmIHRoZSBjYW5kaWRhdGUgYWxyZWFkeSBleGlzdHMgKGluIHRoZSBsb2NhbCBpbmRleCBvciB0aGUgcmVtb3RlXG4gKiAgICAgbWFuaWZlc3QgXHUyMDE0IHRoZSBjYWxsZXIgc3VwcGxpZXMgdGhlIGBleGlzdHNgIHByZWRpY2F0ZSksIGAgMmAsIGAgM2AsIFx1MjAyNlxuICogICAgIGlzIGFwcGVuZGVkIGJlZm9yZSB0aGUgZXh0ZW5zaW9uLlxuICovXG5cbmltcG9ydCB7IGJhc2VuYW1lLCBub3JtYWxpemVWYXVsdFBhdGgsIHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIENoYXJhY3RlcnMgZm9yYmlkZGVuIG9uIGF0IGxlYXN0IG9uZSBzdXBwb3J0ZWQgcGxhdGZvcm0uICovXG5jb25zdCBJTExFR0FMX0ZJTEVOQU1FX0NIQVJTID0gL1s8PjpcIi9cXFxcfD8qXS9nO1xuLyoqIEMwIGNvbnRyb2xzICsgREVMIFx1MjAxNCBuZXZlciB2YWxpZCBpbiBmaWxlbmFtZXMuICovXG5jb25zdCBDT05UUk9MX0NIQVJTID0gL1tcXHgwMC1cXHgxZlxceDdmXS9nO1xuXG4vKiogTWF4IGxlbmd0aCAoaW4gY29kZSBwb2ludHMpIG9mIGEgc2FuaXRpemVkIGRldmljZSBuYW1lLiAqL1xuY29uc3QgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCA9IDMwO1xuXG4vKiogRmFsbGJhY2sgd2hlbiBhIGRldmljZSBuYW1lIHNhbml0aXplcyB0byBub3RoaW5nLiAqL1xuY29uc3QgRkFMTEJBQ0tfREVWSUNFX05BTUUgPSAndW5rbm93bic7XG5cbi8qKiBIaWdoZXN0IGAgTmAgc3VmZml4IHRyaWVkIGJlZm9yZSBnaXZpbmcgdXAuICovXG5jb25zdCBNQVhfQ09MTElTSU9OX1NVRkZJWCA9IDk5OTtcblxuLyoqXG4gKiBTYW5pdGl6ZSBhIGRldmljZSBuYW1lIGZvciB1c2UgaW5zaWRlIGEgZmlsZW5hbWU6IHN0cmlwIGA8PjpcIi9cXFxcfD8qYCBhbmRcbiAqIGNvbnRyb2wgY2hhcmFjdGVycywgdHJpbSB3aGl0ZXNwYWNlIGFuZCBlZGdlIGRvdHMgKFdpbmRvd3Mgc2VnbWVudHMgbWF5XG4gKiBub3QgZW5kIHdpdGggYC5gIG9yIHdoaXRlc3BhY2UpLCB0cnVuY2F0ZSB0byAzMCBjb2RlIHBvaW50cyAobmV2ZXIgc3BsaXRzXG4gKiBhIHN1cnJvZ2F0ZSBwYWlyKS4gUmV0dXJucyBgJ3Vua25vd24nYCB3aGVuIG5vdGhpbmcgc3Vydml2ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZURldmljZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNsZWFuZWQgPSBuYW1lLnJlcGxhY2UoSUxMRUdBTF9GSUxFTkFNRV9DSEFSUywgJycpLnJlcGxhY2UoQ09OVFJPTF9DSEFSUywgJycpO1xuICBjbGVhbmVkID0gWy4uLmNsZWFuZWRdLnNsaWNlKDAsIE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEgpLmpvaW4oJycpO1xuICBjbGVhbmVkID0gY2xlYW5lZC50cmltKCkucmVwbGFjZSgvXlsuXFxzXSt8Wy5cXHNdKyQvZywgJycpO1xuICByZXR1cm4gY2xlYW5lZC5sZW5ndGggPT09IDAgPyBGQUxMQkFDS19ERVZJQ0VfTkFNRSA6IGNsZWFuZWQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgY29uZmxpY3QtY29weSBwYXRoIGZvciBgcGF0aGAuXG4gKlxuICogUHVyZSBhbmQgZGV0ZXJtaW5pc3RpYzogdGhlIHNhbWUgYChwYXRoLCBkZXZpY2VOYW1lLCBub3csIGV4aXN0cylgIGFsd2F5c1xuICogeWllbGRzIHRoZSBzYW1lIHJlc3VsdC4gYG5vd2AgaXMgdGhlIGNvbmZsaWN0J3MgZXBvY2gtbXMgdGltZXN0YW1wICh0aGVcbiAqIGNhbGxlciBwYXNzZXMgaXQgaW4gXHUyMDE0IG5vIGhpZGRlbiBjbG9ja3MpOyBgZXhpc3RzYCBpcyBjb25zdWx0ZWQgZm9yXG4gKiBjb2xsaXNpb24gYXZvaWRhbmNlIGFuZCB0eXBpY2FsbHkgY2hlY2tzIHRoZSBsb2NhbCBpbmRleCBwbHVzIHRoZSByZW1vdGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIFRocm93cyB3aGVuIG1vcmUgdGhhbiBgTUFYX0NPTExJU0lPTl9TVUZGSVhgIG5hbWUgY29sbGlzaW9ucyBvY2N1ciAoYVxuICogZ2VudWluZWx5IHBhdGhvbG9naWNhbCB2YXVsdCBzdGF0ZSB0aGUgY2FsbGVyIHNob3VsZCBzdXJmYWNlLCBub3QgcGFwZXJcbiAqIG92ZXIpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29uZmxpY3RDb3B5UGF0aChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXZpY2VOYW1lOiBzdHJpbmcsXG4gIG5vdzogbnVtYmVyLFxuICBleGlzdHM6IChjYW5kaWRhdGVQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4gPSAoKSA9PiBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGNvbnN0IGRpciA9IHBhcmVudFBhdGgobm9ybWFsaXplZCk7XG4gIGNvbnN0IG5hbWUgPSBiYXNlbmFtZShub3JtYWxpemVkKTtcblxuICBjb25zdCBsYXN0RG90ID0gbmFtZS5sYXN0SW5kZXhPZignLicpO1xuICBjb25zdCBoYXNFeHRlbnNpb24gPSBsYXN0RG90ID4gMDsgLy8gYSBsZWFkaW5nIGRvdCBtYXJrcyBhIGRvdGZpbGUsIG5vdCBhbiBleHRlbnNpb25cbiAgY29uc3Qgc3RlbSA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UoMCwgbGFzdERvdCkgOiBuYW1lO1xuICBjb25zdCBleHRlbnNpb24gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKGxhc3REb3QpIDogJyc7XG5cbiAgY29uc3Qgc3VmZml4ID0gYCAoY29uZmxpY3QgJHtmb3JtYXRDb25mbGljdFN0YW1wKG5vdyl9IC0gZnJvbSAke3Nhbml0aXplRGV2aWNlTmFtZShkZXZpY2VOYW1lKX0pYDtcbiAgY29uc3Qgam9pbiA9IChmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IChkaXIgPT09ICcvJyA/IGAvJHtmaWxlTmFtZX1gIDogYCR7ZGlyfS8ke2ZpbGVOYW1lfWApO1xuXG4gIGxldCBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9JHtleHRlbnNpb259YCk7XG4gIGZvciAobGV0IG4gPSAyOyBuIDw9IE1BWF9DT0xMSVNJT05fU1VGRklYOyBuKyspIHtcbiAgICBpZiAoIWV4aXN0cyhjYW5kaWRhdGUpKSByZXR1cm4gY2FuZGlkYXRlO1xuICAgIGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0gJHtufSR7ZXh0ZW5zaW9ufWApO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICBgY29uZmxpY3RDb3B5UGF0aDogbW9yZSB0aGFuICR7TUFYX0NPTExJU0lPTl9TVUZGSVh9IGNvbGxpc2lvbnMgZm9yICR7SlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZCl9YCxcbiAgKTtcbn1cblxuLyoqIGAyMDI2LTA4LTIwIDE0LTIzYCBcdTIwMTQgVVRDIGRhdGUsIHNwYWNlLCB6ZXJvLXBhZGRlZCBISC1tbS4gTWludXRlcywgbm90IHNlY29uZHMuICovXG5mdW5jdGlvbiBmb3JtYXRDb25mbGljdFN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHBhZCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRVVENGdWxsWWVhcigpfS0ke3BhZChkLmdldFVUQ01vbnRoKCkgKyAxKX0tJHtwYWQoZC5nZXRVVENEYXRlKCkpfWAgK1xuICAgIGAgJHtwYWQoZC5nZXRVVENIb3VycygpKX0tJHtwYWQoZC5nZXRVVENNaW51dGVzKCkpfWBcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRocmVlLXdheSByZWNvbmNpbGlhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA0KS5cbiAqXG4gKiBgY29tcHV0ZVN5bmNQbGFuYCBpcyBhIFBVUkUsIERFVEVSTUlOSVNUSUMgZnVuY3Rpb246IHRoZSBzYW1lIGlucHV0cyBhbHdheXNcbiAqIHByb2R1Y2UgdGhlIHNhbWUgcGxhbiAobWFuaWZlc3QgYW5kIGNoYW5nZSBidWNrZXRzIGFyZSByZS1zb3J0ZWRcbiAqIGludGVybmFsbHk7IGBub3dgIGlzIGEgcGFyYW1ldGVyLCBuZXZlciByZWFkIGZyb20gYSBjbG9jaykuIEl0IGNvbXBhcmVzXG4gKiB0aHJlZSBzdGF0ZXMgZm9yIGV2ZXJ5IHBhdGg6XG4gKlxuICogICAtIHRoZSAqKmxvY2FsIGluZGV4KiogXHUyMDE0IHdoYXQgdGhpcyBkZXZpY2UgbGFzdCBrbmV3IGFzIGF1dGhvcml0YXRpdmVcbiAqICAgICAodGhlIFwiY29tbW9uIGFuY2VzdG9yXCIgb2YgdGhlIHRocmVlLXdheSBtZXJnZSk7XG4gKiAgIC0gdGhlICoqbG9jYWwgY2hhbmdlcyoqIFx1MjAxNCBob3cgbG9jYWwgc3RvcmFnZSBkaXZlcmdlZCBmcm9tIHRoZSBpbmRleFxuICogICAgIHdoaWxlIG9mZmxpbmUgKGBzY2FuLnRzYCBvdXRwdXQpO1xuICogICAtIHRoZSAqKm1hbmlmZXN0KiogXHUyMDE0IHRoZSBhdXRob3JpdHkncyBjdXJyZW50IGhlYWQgcGVyIHBhdGguXG4gKlxuICogYW5kIGVtaXRzIGEgYFN5bmNQbGFuYCAoc2hhcGUgZG9jdW1lbnRlZCBvbiB0aGUgaW50ZXJmYWNlKTogb3BzIHRvIHB1c2gsXG4gKiBvcHMgdG8gcHVsbCwgY29uZmxpY3QgcmVzb2x1dGlvbnMsIGFuZCBmb2xkZXIgcGxhY2Vob2xkZXJzIHRvIHB1c2guXG4gKlxuICogQ29uZmxpY3QgYXJiaXRyYXRpb24gbWlycm9ycyB0aGUgRE8ncyBydWxlIChcdTAwQTc0KTogd2lubmVyID0gaGlnaGVyIGxvZ2ljYWxcbiAqIGNsb2NrOyB0aWUgXHUyMTkyIGdyZWF0ZXIgZGV2aWNlSWQuIFRoZSBsb2NhbCBzaWRlJ3MgKnRlbnRhdGl2ZSogY2xvY2sgaXNcbiAqIGBuZXh0Q2xvY2soaW5kZXggY2xvY2ssIHRoaXNEZXZpY2VJZClgIFx1MjAxNCBleGFjdGx5IHRoZSBjb3VudGVyIHRoZSBETyB3b3VsZFxuICogYXNzaWduIGEgY29tbWl0IGJ1aWxkaW5nIG9uIHRoZSBzYW1lIHBhcmVudCwgc28gdGhlIGNsaWVudCdzIHByZWRpY3Rpb25cbiAqIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uLiBXaGVuIHRoZSByZW1vdGUgc2lkZSB3aW5zLCB0aGUgbG9zaW5nXG4gKiBsb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSBwdXNoaW5nIGl0IHRvIGEgY29uZmxpY3QtY29weSBwYXRoXG4gKiAoYGNvbmZsaWN0bmFtZXMudHNgKTsgd2hlbiB0aGUgbG9jYWwgc2lkZSB3aW5zLCB0aGUgY2xpZW50IHNpbXBseSBjb21taXRzXG4gKiB3aXRoIGl0cyAobm93IHN0YWxlKSBwYXJlbnQgdmVyc2lvbiBhbmQgbGV0cyB0aGUgc2VydmVyIGFyYml0cmF0ZSBcdTIwMTQgdGhlXG4gKiBzZXJ2ZXIgc3ludGhlc2l6ZXMgYW55IGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQsIHdoaWNoXG4gKiBhcnJpdmVzIGxhdGVyIGFzIGFuIG9yZGluYXJ5IGNoYW5nZSBldmVudC5cbiAqL1xuXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzLCBuZXh0Q2xvY2sgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGNvbmZsaWN0Q29weVBhdGggfSBmcm9tICcuL2NvbmZsaWN0bmFtZXMuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuaW1wb3J0IHR5cGUgeyBNYW5pZmVzdEVudHJ5IH0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQgdHlwZSB7IERlbGV0ZWRDYW5kaWRhdGUsIExvY2FsQ2hhbmdlcywgUmVuYW1lQ2FuZGlkYXRlLCBTY2FuQ2FuZGlkYXRlIH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKlxuICogQSBtYW5pZmVzdCBlbnRyeSBhcyByZWNvbmNpbGlhdGlvbiBjb25zdW1lcyBpdC4gU2luY2UgYE1hbmlmZXN0RW50cnlgIGdyZXdcbiAqIGBwYXRoYCwgYGNsb2NrYCwgYW5kIGBpc0ZvbGRlcmAgKHByb3RvY29sIHYxLCBwcmUtcmVsZWFzZSksIHRoaXMgaXMgbm93IHRoZVxuICogbWFuaWZlc3QgZW50cnkgaXRzZWxmIFx1MjAxNCBrZXB0IGFzIGEgbmFtZWQgYWxpYXMgc28gYGNvbXB1dGVTeW5jUGxhbmAncyBpbnB1dFxuICogY29udHJhY3Qgc3RheXMgc2VsZi1kb2N1bWVudGluZy5cbiAqL1xuZXhwb3J0IHR5cGUgUmVtb3RlRmlsZSA9IE1hbmlmZXN0RW50cnk7XG5cbi8qKiBJbnB1dCB0byBgY29tcHV0ZVN5bmNQbGFuYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW5JbnB1dCB7XG4gIGxvY2FsQ2hhbmdlczogTG9jYWxDaGFuZ2VzO1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgbWFuaWZlc3Q6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXTtcbiAgdGhpc0RldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBuYW1lIG9mIHRoaXMgZGV2aWNlIFx1MjAxNCB1c2VkIGluIGNvbmZsaWN0LWNvcHkgZmlsZSBuYW1lcy4gKi9cbiAgdGhpc0RldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIGNvbmZsaWN0LWNvcHkgdGltZXN0YW1wcyAocGFzc2VkIGluIGZvciBkZXRlcm1pbmlzbSkuICovXG4gIG5vdzogbnVtYmVyO1xufVxuXG4vKiogV2h5IGEgcGF0aCB3ZW50IHRocm91Z2ggY29uZmxpY3QgcmVzb2x1dGlvbi4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0UmVhc29uID0gJ2NvbmN1cnJlbnQtZWRpdCcgfCAnYWRkLXZzLWFkZCcgfCAnZGVsZXRlLXZzLWVkaXQnIHwgJ3JlbmFtZS1yYWNlJztcblxuLyoqXG4gKiBBIGNvbW1pdCB0aGlzIGRldmljZSBzaG91bGQgc2VuZCAocGF5bG9hZCBvZiBhIHByb3RvY29sIGBjb21taXRgIG1lc3NhZ2UpLlxuICpcbiAqIGBwYXJlbnRWZXJzaW9uYCBzZW1hbnRpY3M6XG4gKiAgIC0gbG9jYWwtb25seSBjaGFuZ2VzIGFuZCBsb2NhbC13aW5zIGNvbmZsaWN0cyBuYW1lIHRoZSAqaW5kZXgqIGhlYWQgKG9yXG4gKiAgICAgYG51bGxgIGZvciBicmFuZC1uZXcgcGF0aHMpIFx1MjAxNCBkZWxpYmVyYXRlbHkgc3RhbGUgd2hlbiBhIGNvbmZsaWN0IHdhc1xuICogICAgIHByZWRpY3RlZCwgc28gdGhlIERPIGFyYml0cmF0ZXMgYW5kIHByZXNlcnZlcyB0aGUgbG9zaW5nIHJlbW90ZVxuICogICAgIGNvbnRlbnQgc2VydmVyLXNpZGU7XG4gKiAgIC0gY29uZmxpY3QtY29weSBwdXNoZXMgbmFtZSB0aGUgKnJlbW90ZSogaGVhZCAoZmFzdC1wYXRoOiB0aGV5IGJ1aWxkIG9uXG4gKiAgICAgdGhlIHdpbm5lciBhbmQgbXVzdCBub3QgcmUtY29uZmxpY3QpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnIHwgJ2NvbmZsaWN0Q29weSc7XG4gIHBhdGg6IHN0cmluZztcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIENvbnRlbnQgaGFzaDsgZGVsZXRlIG9wcyByZXVzZSB0aGUgZGVsZXRlZCBjb250ZW50J3MgaGFzaC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIHJlbmFtZSB0byBjb21taXQgYXMgb25lIGNoYWluIG1pZ3JhdGlvbiAoRlItOSkuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gb2YgdGhlIGBmcm9tUGF0aGAgaGVhZCB0aGlzIHJlbmFtZSBidWlsZHMgb24uICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBQdXNoT3AgPSBQdXNoRmlsZU9wIHwgUHVzaFJlbmFtZU9wO1xuXG4vKiogUmVtb3RlIGNvbnRlbnQgdGhpcyBkZXZpY2Ugc2hvdWxkIGZldGNoIGFuZCBtYXRlcmlhbGl6ZSB2aWEgYGFwcGx5UHVsbGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnO1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUcnVlIGZvciB0b21ic3RvbmVzIChraW5kIGAnZGVsZXRlJ2ApLiAqL1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1bGxzIChGUi0xMCkgXHUyMDE0IG1hdGVyaWFsaXplIHdpdGggYGVuc3VyZURpcmAuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgcmVtb3RlIHJlbmFtZSB0byBmb2xsb3cgbG9jYWxseSAoZGV0ZWN0ZWQgYnkgaGFzaCBjb3JyZWxhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbn1cblxuZXhwb3J0IHR5cGUgUHVsbE9wID0gUHVsbEZpbGVPcCB8IFB1bGxSZW5hbWVPcDtcblxuLyoqXG4gKiBPbmUgYXJiaXRyYXRlZCBjb25mbGljdC4gYGxvc2VyQ29udGVudGAgaXMgYCdub25lJ2Agd2hlbiB0aGUgbG9zaW5nIHNpZGVcbiAqIHdhcyBhIGRlbGV0aW9uIChub3RoaW5nIHRvIHByZXNlcnZlKS4gV2hlbiB0aGUgbG9jYWwgY29udGVudCBsb3N0IGFuZCBoYWRcbiAqIGNvbnRlbnQsIGBjb25mbGljdENvcHlQYXRoYCBuYW1lcyB3aGVyZSB0aGUgcGxhbiBwcmVzZXJ2ZXMgaXQgKHRoZSBwdXNoXG4gKiBpdHNlbGYgaXMgaW4gYFN5bmNQbGFuLnB1c2hlc2Agd2l0aCBraW5kIGAnY29uZmxpY3RDb3B5J2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0T3Age1xuICBwYXRoOiBzdHJpbmc7XG4gIHJlYXNvbjogQ29uZmxpY3RSZWFzb247XG4gIHdpbm5lcjogJ2xvY2FsJyB8ICdyZW1vdGUnO1xuICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcgfCAncmVtb3RlJyB8ICdub25lJztcbiAgY29uZmxpY3RDb3B5UGF0aD86IHN0cmluZztcbiAgcmVtb3RlOiB7IHZlcnNpb246IHN0cmluZzsgaGFzaDogc3RyaW5nOyBzaXplOiBudW1iZXI7IGRlbGV0ZWQ6IGJvb2xlYW47IGNsb2NrOiBMb2dpY2FsQ2xvY2sgfTtcbiAgLyoqIFRoZSB0ZW50YXRpdmUgY2xvY2sgdGhlIGxvY2FsIHNpZGUgd2FzIGFyYml0cmF0ZWQgd2l0aC4gKi9cbiAgbG9jYWxDbG9jazogTG9naWNhbENsb2NrO1xufVxuXG4vKipcbiAqIFRoZSBjb21wbGV0ZSByZWNvbmNpbGlhdGlvbiByZXN1bHQgZm9yIG9uZSBzeW5jIGN5Y2xlLiBPcHMgYXJlIHNvcnRlZCBieVxuICogdGFyZ2V0IHBhdGggKHJlbmFtZXMgYnkgYHRvUGF0aGApOyBldmVyeSBhcnJheSBtYXkgYmUgZW1wdHkuIGBwdXNoZXNgIGFuZFxuICogYHB1bGxzYCBhcmUgaW5kZXBlbmRlbnQgXHUyMDE0IGEgcGF0aCBhcHBlYXJzIGF0IG1vc3Qgb25jZSBpbiBlYWNoLiBQdXNoZXMgYXJlXG4gKiBOT1QgYXBwbGllZCB0byB0aGUgbG9jYWwgaW5kZXggdW50aWwgdGhlIHNlcnZlciBhY2tzIHRoZW07IHB1bGxzIGFyZVxuICogYXBwbGllZCBieSBgYXBwbHlQdWxsYCAoYGVuZ2luZS50c2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuIHtcbiAgLyoqIENvbW1pdHMgdG8gc2VuZCwgaW4gb3JkZXIuICovXG4gIHB1c2hlczogUHVzaE9wW107XG4gIC8qKiBSZW1vdGUgY2hhbmdlcyB0byBtYXRlcmlhbGl6ZSwgaW4gb3JkZXIuICovXG4gIHB1bGxzOiBQdWxsT3BbXTtcbiAgLyoqIENvbmZsaWN0cyB0aGF0IHdlcmUgYXJiaXRyYXRlZCAoaW5mb3JtYXRpb25hbDsgc2lkZSBlZmZlY3RzIGxpdmUgaW4gcHVzaGVzL3B1bGxzKS4gKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcGF0aHMgdG8gY3JlYXRlIHJlbW90ZWx5IChGUi0xMCkuICovXG4gIGZvbGRlclB1c2hlczogc3RyaW5nW107XG59XG5cbi8qKiBJbnRlcm5hbDogYSBsb2NhbCBjYW5kaWRhdGUgKGFkZGVkL21vZGlmaWVkL2RlbGV0ZWQpIHVuaWZpZWQgZm9yIHJlc29sdXRpb24uICovXG5pbnRlcmZhY2UgTG9jYWxDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ3Jlc3RvcmUnIHwgJ2RlbGV0ZSc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBaRVJPX0NMT0NLOiBMb2dpY2FsQ2xvY2sgPSB7IGNvdW50ZXI6IDAsIGRldmljZUlkOiAnJyB9O1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHN5bmMgcGxhbi4gU2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgbW9kZWwgYW5kIHRoZSBvcFxuICogc2VtYW50aWNzLiBUaHJvd3Mgbm90aGluZyBvbiBvcmRpbmFyeSBkaXZlcmdlbmNlIFx1MjAxNCBjb25mbGljdHMgYXJlIGRhdGEsXG4gKiBub3QgZXJyb3JzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVN5bmNQbGFuKGlucHV0OiBTeW5jUGxhbklucHV0KTogU3luY1BsYW4ge1xuICBjb25zdCB7IGxvY2FsQ2hhbmdlcywgaW5kZXgsIHRoaXNEZXZpY2VJZCwgdGhpc0RldmljZU5hbWUsIG5vdyB9ID0gaW5wdXQ7XG4gIGNvbnN0IG1hbmlmZXN0ID0gWy4uLmlucHV0Lm1hbmlmZXN0XS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xuICBjb25zdCBtYW5pZmVzdEJ5UGF0aCA9IG5ldyBNYXAobWFuaWZlc3QubWFwKChlbnRyeSkgPT4gW2VudHJ5LnBhdGgsIGVudHJ5XSkpO1xuXG4gIGNvbnN0IHB1c2hlczogUHVzaE9wW10gPSBbXTtcbiAgY29uc3QgcHVsbHM6IFB1bGxPcFtdID0gW107XG4gIGNvbnN0IGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG5cbiAgLy8gRXZlcnkgcGF0aCB0aGUgbG9jYWwgc2lkZSBkaXZlcmdlZCBvbiAoc2NhbiBidWNrZXRzICsgYm90aCBlbmRzIG9mIHJlbmFtZXMpLlxuICBjb25zdCBsb2NhbFBhdGhzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMuYWRkZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMubW9kaWZpZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XG4gIGZvciAoY29uc3QgZCBvZiBsb2NhbENoYW5nZXMuZGVsZXRlZCkgbG9jYWxQYXRocy5hZGQoZC5wYXRoKTtcbiAgZm9yIChjb25zdCByIG9mIGxvY2FsQ2hhbmdlcy5yZW5hbWVkKSB7XG4gICAgbG9jYWxQYXRocy5hZGQoci5mcm9tKTtcbiAgICBsb2NhbFBhdGhzLmFkZChyLnRvKTtcbiAgfVxuXG4gIC8vIFBhdGhzIGFscmVhZHkgY29uc3VtZWQgYnkgYW4gZWFybGllciBwaGFzZSAocmVuYW1lIGNvcnJlbGF0aW9uIGV0Yy4pLlxuICBjb25zdCBjb25zdW1lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0IHBhdGhFeGlzdHMgPSAocGF0aDogc3RyaW5nKTogYm9vbGVhbiA9PiBwYXRoIGluIGluZGV4IHx8IG1hbmlmZXN0QnlQYXRoLmhhcyhwYXRoKTtcblxuICAvLyAtLS0gUGhhc2UgQTogbG9jYWwgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gVW5jb250ZXN0ZWQ6IG9uZSBQdXNoUmVuYW1lT3AuIENvbnRlc3RlZCAocmVtb3RlIGNoYW5nZWQgYXQgZWl0aGVyIGVuZCk6XG4gIC8vIGRlY29tcG9zZSBcdTIwMTQgdGhlIGBmcm9tYCBzaWRlIGlzIHJlc29sdmVkIG9uIGl0cyBvd24gKHVzdWFsbHkgdG9tYnN0b25lZFxuICAvLyBvciBwdWxsZWQpLCB0aGUgcmVuYW1lZCBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIHRocm91Z2ggdGhlIGdlbmVyaWNcbiAgLy8gY29udGVudCBtYWNoaW5lcnkuIENvbnRlbnQgaXMgbmV2ZXIgbG9zdCBlaXRoZXIgd2F5LlxuICBmb3IgKGNvbnN0IHJlbmFtZSBvZiBbLi4ubG9jYWxDaGFuZ2VzLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEuZnJvbSwgYi5mcm9tKSkpIHtcbiAgICBjb25zdCBpbmRleEZyb20gPSBpbmRleFtyZW5hbWUuZnJvbV07XG4gICAgY29uc3QgaW5kZXhUbyA9IGluZGV4W3JlbmFtZS50b107XG4gICAgY29uc3QgcmVtb3RlRnJvbSA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUuZnJvbSk7XG4gICAgY29uc3QgcmVtb3RlVG8gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLnRvKTtcblxuICAgIGNvbnN0IGZyb21DaGFuZ2VkID0gcmVtb3RlRnJvbVxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhGcm9tLCByZW1vdGVGcm9tKVxuICAgICAgOiBpbmRleEZyb20/LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkOyAvLyBhYnNlbnQgcmVtb3RlbHkgKyBsaXZlIGxvY2FsbHkgXHUyMUQyIGNoYW5nZWRcbiAgICBjb25zdCB0b0NoYW5nZWQgPSByZW1vdGVUb1xuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhUbywgcmVtb3RlVG8pXG4gICAgICA6IGZhbHNlOyAvLyBhYnNlbnQgcmVtb3RlbHkgXHUyMUQyIG5vdGhpbmcgdG8gcmFjZSBhdCBgdG9gXG5cbiAgICBpZiAoIWZyb21DaGFuZ2VkICYmICF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgdG9QYXRoOiByZW5hbWUudG8sXG4gICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gYGZyb21gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghZnJvbUNoYW5nZWQpIHtcbiAgICAgIC8vIE5vdGhpbmcgcmVtb3RlIHRoZXJlIFx1MjAxNCB0aGUgbW92ZSBpdHNlbGYgcmVtb3ZlcyB0aGUgb2xkIHBhdGguXG4gICAgICBpZiAoaW5kZXhGcm9tICYmIGluZGV4RnJvbS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tLnZlcnNpb25JZCxcbiAgICAgICAgICBoYXNoOiBpbmRleEZyb20uaGFzaCxcbiAgICAgICAgICBzaXplOiBpbmRleEZyb20uc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICghcmVtb3RlRnJvbSB8fCByZW1vdGVGcm9tLmRlbGV0ZWQpIHtcbiAgICAgIC8vIFJlbW90ZSBkZWxldGVkIChvciBtaWdyYXRlZCBhd2F5IGZyb20pIGBmcm9tYCBcdTIwMTQgZGVsZXRpb24gc3RhbmRzIGZvclxuICAgICAgLy8gdGhlIG9sZCBwYXRoOyB0aGUgcmVuYW1lZCBjb250ZW50IHN1cnZpdmVzIGF0IGB0b2AuXG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZSgnZGVsZXRlJywgcmVuYW1lLmZyb20sIHtcbiAgICAgICAgICBoYXNoOiByZW1vdGVGcm9tPy5oYXNoID8/IGluZGV4RnJvbT8uaGFzaCA/PyByZW5hbWUuaGFzaCxcbiAgICAgICAgICBzaXplOiByZW1vdGVGcm9tPy5zaXplID8/IGluZGV4RnJvbT8uc2l6ZSA/PyByZW5hbWUuc2l6ZSxcbiAgICAgICAgICB2ZXJzaW9uOiByZW1vdGVGcm9tPy52ZXJzaW9uID8/ICcnLFxuICAgICAgICAgIGNsb2NrOiByZW1vdGVGcm9tPy5jbG9jayA/PyBpbmRleEZyb20/LmNsb2NrID8/IFpFUk9fQ0xPQ0ssXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdGUgZWRpdGVkIGBmcm9tYC4gVGhlIHJlbW90ZSBlZGl0IGtlZXBzIHRoZSBvbGQgcGF0aDsgdGhlIG1vdmVkXG4gICAgICAvLyBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIGJlbG93IFx1MjAxNCBhIHJlbmFtZS1yYWNlIHRoZSBsb2NhbCBzaWRlXG4gICAgICAvLyBjb25jZWRlcyB1bmxlc3MgaXRzIGNsb2NrIHdpbnMgdGhlIHJlbmFtZSBwdXNoLlxuICAgICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhpbmRleEZyb20/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xuICAgICAgaWYgKGNvbXBhcmVDbG9ja3MocmVtb3RlRnJvbS5jbG9jaywgbG9jYWxDbG9jaykgPiAwKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW5hbWUuZnJvbSwgcmVtb3RlRnJvbSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ3JlbW90ZScsXG4gICAgICAgICAgLy8gTG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgdGhlIHJlbmFtZSBpdHNlbGYgKHB1c2hlZCBhdCBgdG9gKS5cbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgcmVtb3RlOiByZW1vdGVTdW1tYXJ5KHJlbW90ZUZyb20pLFxuICAgICAgICAgIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHJlYXNvbjogJ3JlbmFtZS1yYWNlJyxcbiAgICAgICAgICB3aW5uZXI6ICdsb2NhbCcsXG4gICAgICAgICAgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlOyAvLyB0aGUgcmVuYW1lIHB1c2ggY2FycmllcyB0aGUgY29udGVudDsgbm8gYHRvYCBvcCBuZWVkZWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBgdG9gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghdG9DaGFuZ2VkKSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIHBhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhUbz8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChyZW5hbWUudG8sIGluZGV4VG8sIHJlbW90ZVRvIGFzIFJlbW90ZUZpbGUsIHtcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBraW5kOiBpbmRleFRvPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6ICdhZGQnLFxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQjogcmVtb3RlIHJlbmFtZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gQSBwYXRoIGxpdmUgaW4gdGhlIGluZGV4IGJ1dCBBQlNFTlQgZnJvbSB0aGUgbWFuaWZlc3Qgd2FzIG1pZ3JhdGVkIGJ5IHRoZVxuICAvLyBhdXRob3JpdHkgKHRvbWJzdG9uZXMgYXBwZWFyIGluIHRoZSBtYW5pZmVzdCB3aXRoIGRlbGV0ZWQ6dHJ1ZSBcdTIwMTQgb25seSBhXG4gIC8vIHJlbmFtZSByZW1vdmVzIGEgcGF0aCkuIENvcnJlbGF0ZSBieSBjb250ZW50IGhhc2ggYWdhaW5zdCBuZXcgbWFuaWZlc3RcbiAgLy8gcGF0aHMsIHNhbWUtcGFyZW50IHByZWZlcnJlZCwgc21hbGxlc3QgcGF0aCB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLlxuICBmb3IgKGNvbnN0IGZyb20gb2YgT2JqZWN0LmtleXMoaW5kZXgpXG4gICAgLmZpbHRlcigocCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBpbmRleFtwXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gICAgICByZXR1cm4gZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiYgIWVudHJ5LmlzRm9sZGVyO1xuICAgIH0pXG4gICAgLnNvcnQoY29tcGFyZVN0cmluZ3MpKSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKGZyb20pIHx8IGNvbnN1bWVkLmhhcyhmcm9tKSkgY29udGludWU7XG4gICAgaWYgKG1hbmlmZXN0QnlQYXRoLmhhcyhmcm9tKSkgY29udGludWU7IC8vIHByZXNlbnQgKGxpdmUgb3IgdG9tYnN0b25lZCkgXHUyMUQyIG5vdCBtaWdyYXRlZFxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZnJvbV0gYXMgTG9jYWxJbmRleEVudHJ5O1xuXG4gICAgbGV0IGJlc3Q6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJlc3RTYW1lRGlyID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgbWFuaWZlc3QpIHtcbiAgICAgIGlmIChjYW5kaWRhdGUuZGVsZXRlZCkgY29udGludWU7XG4gICAgICBpZiAobG9jYWxQYXRocy5oYXMoY2FuZGlkYXRlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qga25vd24gPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgICBpZiAoa25vd24gIT09IHVuZGVmaW5lZCAmJiBrbm93bi5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIHRhcmdldCBub3QgbmV3XG4gICAgICBpZiAoY2FuZGlkYXRlLmhhc2ggIT09IGVudHJ5Lmhhc2gpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2FtZURpciA9IHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGZyb20pO1xuICAgICAgaWYgKGJlc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBiZXN0ID0gY2FuZGlkYXRlO1xuICAgICAgICBiZXN0U2FtZURpciA9IHNhbWVEaXI7XG4gICAgICB9IGVsc2UgaWYgKHNhbWVEaXIgJiYgIWJlc3RTYW1lRGlyKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmVzdCkge1xuICAgICAgcHVsbHMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBmcm9tUGF0aDogZnJvbSxcbiAgICAgICAgdG9QYXRoOiBiZXN0LnBhdGgsXG4gICAgICAgIGhhc2g6IGJlc3QuaGFzaCxcbiAgICAgICAgc2l6ZTogYmVzdC5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBiZXN0LnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBiZXN0LmNsb2NrLFxuICAgICAgfSk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgICBjb25zdW1lZC5hZGQoYmVzdC5wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWJzZW50IHdpdGhvdXQgY29ycmVsYXRpb246IHRoZSBhdXRob3JpdHkgbm8gbG9uZ2VyIGtub3dzIHRoZSBwYXRoLlxuICAgICAgLy8gVHJlYXQgYXMgYSByZW1vdGUgZGVsZXRlIHdpdGggdW5rbm93biBoZWFkIHZlcnNpb24gKCcnIFx1MjAxNCB0aGUgbmV4dFxuICAgICAgLy8gZnVsbCBtYW5pZmVzdCBoZWFscyB0aGUgdmVyc2lvbiBpZCkuIFRoaXMgYWxzbyBjb3ZlcnMgcmVtb3RlXG4gICAgICAvLyByZW5hbWUrZWRpdCwgd2hpY2ggZ2VudWluZWx5IGlzIGRlbGV0ZSArIGFkZC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCBmcm9tLCB7XG4gICAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICAgIHZlcnNpb246ICcnLFxuICAgICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEM6IHJlbWFpbmluZyByZW1vdGUtb25seSBjaGFuZ2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIGZvciAoY29uc3QgcmVtb3RlIG9mIG1hbmlmZXN0KSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKHJlbW90ZS5wYXRoKSB8fCBjb25zdW1lZC5oYXMocmVtb3RlLnBhdGgpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W3JlbW90ZS5wYXRoXTtcbiAgICBpZiAoIXJlbW90ZUVudHJ5Q2hhbmdlZChlbnRyeSwgcmVtb3RlKSkgY29udGludWU7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnYWRkJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICAgICAgfVxuICAgICAgLy8gZGVsZXRlZCArIG5ldmVyIGtub3duIGxvY2FsbHkgXHUyMUQyIG5vdGhpbmcgdG8gZG9cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHJlbW90ZS5wYXRoLCByZW1vdGUpKTsgLy8gaW5jbHVkZXMgdG9tYnN0b25lXHUyMTkydG9tYnN0b25lIHZlcnNpb24gY2F0Y2gtdXBcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdyZXN0b3JlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH1cbiAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEQ6IGxvY2FsIGNhbmRpZGF0ZXMgKGxvY2FsLW9ubHkgcHVzaGVzICsgYm90aC1jaGFuZ2VkKSAtLS0tLS0tXG4gIGNvbnN0IGNhbmRpZGF0ZXM6IExvY2FsQ2FuZGlkYXRlW10gPSBbXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmFkZGVkLm1hcCgoYykgPT4gKHsgLi4uYywga2luZDogJ2FkZCcgYXMgY29uc3QgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5tb2RpZmllZC5tYXAoKGMpID0+ICh7XG4gICAgICAuLi5jLFxuICAgICAga2luZDogaW5kZXhbYy5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAoJ3Jlc3RvcmUnIGFzIGNvbnN0KSA6ICgnZWRpdCcgYXMgY29uc3QpLFxuICAgIH0pKSxcbiAgICAuLi5sb2NhbENoYW5nZXMuZGVsZXRlZC5tYXAoKGQpOiBMb2NhbENhbmRpZGF0ZSA9PiAoeyAuLi5kLCBraW5kOiAnZGVsZXRlJyB9KSksXG4gIF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcblxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgY29uc3QgcmVtb3RlID0gbWFuaWZlc3RCeVBhdGguZ2V0KGNhbmRpZGF0ZS5wYXRoKTtcbiAgICBjb25zdCByZW1vdGVDaGFuZ2VkSGVyZSA9XG4gICAgICByZW1vdGUgIT09IHVuZGVmaW5lZCAmJiAoZW50cnkgIT09IHVuZGVmaW5lZCA/IHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQgOiAhcmVtb3RlLmRlbGV0ZWQpO1xuICAgIGlmICghcmVtb3RlQ2hhbmdlZEhlcmUpIHtcbiAgICAgIHB1c2hMb2NhbChjYW5kaWRhdGUsIGVudHJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzb2x2ZUNvbnRlc3RlZFBhdGgoY2FuZGlkYXRlLnBhdGgsIGVudHJ5LCByZW1vdGUgYXMgUmVtb3RlRmlsZSwgY2FuZGlkYXRlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHB1c2hlczogcHVzaGVzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKSksXG4gICAgcHVsbHM6IHB1bGxzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKSksXG4gICAgY29uZmxpY3RzOiBjb25mbGljdHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKSxcbiAgICBmb2xkZXJQdXNoZXM6IFsuLi5sb2NhbENoYW5nZXMuZW1wdHlGb2xkZXJzXS5zb3J0KGNvbXBhcmVTdHJpbmdzKSxcbiAgfTtcblxuICAvLyAtLS0gaGVscGVycyAoY2xvc2Ugb3ZlciB0aGUgYWNjdW11bGF0b3JzKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBmdW5jdGlvbiBwdXNoTG9jYWwoY2FuZGlkYXRlOiBMb2NhbENhbmRpZGF0ZSwgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCk6IHZvaWQge1xuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgIHBhdGg6IGNhbmRpZGF0ZS5wYXRoLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IGVudHJ5Py5oYXNoID8/IGNhbmRpZGF0ZS5oYXNoLFxuICAgICAgICBzaXplOiBlbnRyeT8uc2l6ZSA/PyBjYW5kaWRhdGUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBwdXNoZXMucHVzaCh7XG4gICAgICBraW5kOiBjYW5kaWRhdGUua2luZCxcbiAgICAgIHBhdGg6IGNhbmRpZGF0ZS5wYXRoLFxuICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgaGFzaDogY2FuZGlkYXRlLmhhc2gsXG4gICAgICBzaXplOiBjYW5kaWRhdGUuc2l6ZSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCb3RoIHNpZGVzIGNoYW5nZWQgb25lIHBhdGguIEFyYml0cmF0ZSBwZXIgXHUwMEE3NC4gTG9jYWwgZGVsZXRpb25zIG5ldmVyIGdldFxuICAgKiBhIGNvbmZsaWN0IGNvcHkgKG5vIGNvbnRlbnQgdG8gcHJlc2VydmUpOyBsb2NhbCAqY29udGVudCogdGhhdCBsb3NlcyBpc1xuICAgKiBwcmVzZXJ2ZWQgdmlhIGEgY29uZmxpY3QtY29weSBwdXNoLlxuICAgKi9cbiAgZnVuY3Rpb24gcmVzb2x2ZUNvbnRlc3RlZFBhdGgoXG4gICAgcGF0aDogc3RyaW5nLFxuICAgIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gICAgcmVtb3RlOiBSZW1vdGVGaWxlLFxuICAgIGxvY2FsOiBMb2NhbENhbmRpZGF0ZSxcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhlbnRyeT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XG4gICAgY29uc3QgcmVtb3RlV2lucyA9IGNvbXBhcmVDbG9ja3MocmVtb3RlLmNsb2NrLCBsb2NhbENsb2NrKSA+IDA7IC8vIDAgXHUyMUQyIGxvY2FsIChkb2N1bWVudGVkKVxuICAgIGNvbnN0IHN1bW1hcnkgPSByZW1vdGVTdW1tYXJ5KHJlbW90ZSk7XG4gICAgY29uc3QgcmVhc29uOiBDb25mbGljdFJlYXNvbiA9XG4gICAgICBsb2NhbC5raW5kID09PSAnZGVsZXRlJyB8fCByZW1vdGUuZGVsZXRlZFxuICAgICAgICA/ICdkZWxldGUtdnMtZWRpdCdcbiAgICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAnYWRkLXZzLWFkZCdcbiAgICAgICAgICA6ICdjb25jdXJyZW50LWVkaXQnO1xuXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnICYmIHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBCb3RoIGRlbGV0ZWQgXHUyMDE0IGNvbnZlcmdlIHNpbGVudGx5IG9uIHRoZSByZW1vdGUgdG9tYnN0b25lLlxuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcGF0aCwgcmVtb3RlKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICAvLyBMb2NhbCBkZWxldGUgdnMgcmVtb3RlIGVkaXQuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcGF0aCwgcmVtb3RlKSk7IC8vIGZpbGUgaXMgcmVjcmVhdGVkXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ25vbmUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gbG9jYWwuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeT8uc2l6ZSA/PyBsb2NhbC5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBMb2NhbCBlZGl0IHZzIHJlbW90ZSBkZWxldGUuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25jdXJyZW50IGNvbnRlbnQgKGVkaXQtdnMtZWRpdCBvciBhZGQtdnMtYWRkKS5cbiAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxuICAgICAgKTtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXG4gICAgICAgIHBhdGgsXG4gICAgICAgIC8vIERlbGliZXJhdGVseSB0aGUgKHN0YWxlKSBpbmRleCBwYXJlbnQ6IHRoZSBETyBtdXN0IGFyYml0cmF0ZSBhbmRcbiAgICAgICAgLy8gc3ludGhlc2l6ZSB0aGUgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudC5cbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICBoYXNoOiBsb2NhbC5oYXNoLFxuICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVzaCB0aGUgbG9zaW5nIGxvY2FsIGNvbnRlbnQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGg7IHJldHVybnMgdGhlIHBhdGgsXG4gICAqIG9yIGB1bmRlZmluZWRgIHdoZW4gdGhlIGxvc2luZyBjb250ZW50IGlzIGJ5dGUtaWRlbnRpY2FsIHRvIHRoZSB3aW5uZXInc1xuICAgKiAoYSBzYW1lLWNvbnRlbnQgcmFjZSBcdTIwMTQgbm90aGluZyBkaXN0aW5jdCB0byBwcmVzZXJ2ZTsgbWF0Y2hlcyB0aGUgc2VydmVyJ3NcbiAgICogYXJiaXRyYXRpb24sIHdoaWNoIGxpa2V3aXNlIHN5bnRoZXNpemVzIG5vIGNvcHkgZm9yIGlkZW50aWNhbCBjb250ZW50KS5cbiAgICovXG4gIGZ1bmN0aW9uIHB1c2hDb25mbGljdENvcHkocGF0aDogc3RyaW5nLCBsb2NhbDogTG9jYWxDYW5kaWRhdGUsIHJlbW90ZTogUmVtb3RlRmlsZSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKGxvY2FsLmhhc2ggPT09IHJlbW90ZS5oYXNoKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvcHlQYXRoID0gY29uZmxpY3RDb3B5UGF0aChwYXRoLCB0aGlzRGV2aWNlTmFtZSwgbm93LCBwYXRoRXhpc3RzKTtcbiAgICBwdXNoZXMucHVzaCh7XG4gICAgICBraW5kOiAnY29uZmxpY3RDb3B5JyxcbiAgICAgIHBhdGg6IGNvcHlQYXRoLFxuICAgICAgLy8gQnVpbGQgb24gdGhlIHdpbm5pbmcgcmVtb3RlIGhlYWQ6IHRoaXMgcHVzaCBtdXN0IGZhc3QtcGF0aC5cbiAgICAgIHBhcmVudFZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgIHNpemU6IGxvY2FsLnNpemUsXG4gICAgfSk7XG4gICAgcmV0dXJuIGNvcHlQYXRoO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtbGV2ZWwgaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcHVsbEZpbGUoXG4gIGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSxcbiAgcGF0aDogc3RyaW5nLFxuICByZW1vdGU6IFBpY2s8UmVtb3RlRmlsZSwgJ2hhc2gnIHwgJ3NpemUnIHwgJ3ZlcnNpb24nIHwgJ2Nsb2NrJyB8ICdpc0ZvbGRlcic+ICYge1xuICAgIGRlbGV0ZWQ/OiBib29sZWFuO1xuICB9LFxuKTogUHVsbEZpbGVPcCB7XG4gIHJldHVybiB7XG4gICAga2luZCxcbiAgICBwYXRoLFxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQgPz8ga2luZCA9PT0gJ2RlbGV0ZScsXG4gICAgLi4uKHJlbW90ZS5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVtb3RlU3VtbWFyeShyZW1vdGU6IFJlbW90ZUZpbGUpOiBDb25mbGljdE9wWydyZW1vdGUnXSB7XG4gIHJldHVybiB7XG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQsXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcbiAgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSByZW1vdGUgaGVhZCBmb3IgYSBwYXRoIGRpZmZlcnMgZnJvbSB3aGF0IHRoZSBpbmRleCByZWNvcmRzLlxuICogVmVyc2lvbiBpZHMgYXJlIHRoZSBwcmltYXJ5IHNpZ25hbCAoY2xpZW50IGFuZCBETyBzaGFyZSBvbmUgaWQgc3BhY2UpO1xuICogYSBwYXRoIGFic2VudCByZW1vdGVseSBjb3VudHMgYXMgY2hhbmdlZCBvbmx5IHdoaWxlIHRoZSBpbmRleCBzdGlsbCBob2xkc1xuICogaXQgbGl2ZSBcdTIwMTQgY2FsbGVycyBkZWNpZGUgd2hhdCBhYnNlbmNlICptZWFucyogKHJlbmFtZSB2cyBkZWxldGUpLlxuICovXG5mdW5jdGlvbiByZW1vdGVFbnRyeUNoYW5nZWQoXG4gIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gIHJlbW90ZTogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZCxcbik6IGJvb2xlYW4ge1xuICBpZiAocmVtb3RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHJldHVybiAhcmVtb3RlLmRlbGV0ZWQ7XG4gIHJldHVybiByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkO1xufVxuXG5mdW5jdGlvbiBvcFBhdGgob3A6IFB1c2hPcCB8IFB1bGxPcCk6IHN0cmluZyB7XG4gIHJldHVybiBvcC5raW5kID09PSAncmVuYW1lJyA/IG9wLnRvUGF0aCA6IG9wLnBhdGg7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogTG9jYWwgY2hhbmdlIGRldGVjdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAzKS5cbiAqXG4gKiBgc2NhblZhdWx0YCB3YWxrcyB0aGUgc3RvcmFnZSBhZGFwdGVyLCBhcHBsaWVzIHRoZSBzaGFyZWQgaWdub3JlIHJ1bGVzLFxuICogaGFzaGVzIGV2ZXJ5IG5vbi1pZ25vcmVkIGZpbGUgKHNoYTI1NiBcdTIwMTQgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpIGFuZCBkaWZmc1xuICogdGhlIHJlc3VsdCBhZ2FpbnN0IHRoZSBjbGllbnQncyBgTG9jYWxJbmRleGAuIFRoZSBkaWZmIGNsYXNzaWZpZXM6XG4gKlxuICogICAtIGBhZGRlZGAgICAgXHUyMDE0IGZpbGUgcHJlc2VudCwgcGF0aCB1bmtub3duIHRvIHRoZSBpbmRleDtcbiAqICAgLSBgbW9kaWZpZWRgIFx1MjAxNCBmaWxlIHByZXNlbnQsIGNvbnRlbnQgaGFzaCBkaWZmZXJzIGZyb20gdGhlIGluZGV4IGVudHJ5LlxuICogICAgICAgICAgICAgICAgICBBIGZpbGUgd2hvc2UgaW5kZXggZW50cnkgaXMgYSAqdG9tYnN0b25lKiBhbHNvIGxhbmRzIGhlcmVcbiAqICAgICAgICAgICAgICAgICAgKGRvY3VtZW50ZWQgZGVjaXNpb24pOiB3aGV0aGVyIGl0IGlzIGFuIGVkaXQtb2YtZGVsZXRlZFxuICogICAgICAgICAgICAgICAgICBvciBhIHB1cmUgcmVzdXJyZWN0LCB0aGUgcmVzb2x1dGlvbiBpcyBpZGVudGljYWwgXHUyMDE0IGxvY2FsXG4gKiAgICAgICAgICAgICAgICAgIGNvbnRlbnQgZXhpc3RzIHRoYXQgdGhlIGluZGV4IGhlYWQgZG9lcyBub3QgcmVmbGVjdDtcbiAqICAgLSBgZGVsZXRlZGAgIFx1MjAxNCBpbmRleCBlbnRyeSBsaXZlLCBmaWxlIGdvbmU7XG4gKiAgIC0gYHJlbmFtZWRgICBcdTIwMTQgYSBkZWxldGUgKyBhZGQgcGFpciAqd2l0aGluIG9uZSBzY2FuKiB3aG9zZSBjb250ZW50XG4gKiAgICAgICAgICAgICAgICAgIGhhc2hlcyBtYXRjaCAoQVJDSElURUNUVVJFIFx1MDBBNzQgcmVuYW1lIGNvcnJlbGF0aW9uKS4gQVxuICogICAgICAgICAgICAgICAgICByZW5hbWUgd2hvc2UgY29udGVudCBhbHNvIGNoYW5nZWQgKHJlbmFtZSArIGVkaXQpIG5vXG4gKiAgICAgICAgICAgICAgICAgIGxvbmdlciBjb3JyZWxhdGVzIGFuZCBmYWxscyBiYWNrIHRvIGRlbGV0ZSArIGFkZCBcdTIwMTQgdGhhdFxuICogICAgICAgICAgICAgICAgICBpcyB0aGUgZG9jdW1lbnRlZCwgY29ycmVjdCB2MSBiZWhhdmlvcjtcbiAqICAgLSBgZW1wdHlGb2xkZXJzYCBcdTIwMTQgZGlyZWN0b3JpZXMgZXhpc3RpbmcgaW4gc3RvcmFnZSBidXQgcmVwcmVzZW50ZWRcbiAqICAgICAgICAgICAgICAgICAgbmVpdGhlciBieSBhIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGluIHRoZSBpbmRleCBub3IgYnlcbiAqICAgICAgICAgICAgICAgICAgYW55IGZpbGUgYmVuZWF0aCB0aGVtIChGUi0xMCkuXG4gKlxuICogVGhlIGZ1bmN0aW9uIHRha2VzIGBub3dgIGFuZCB0aGUgaWdub3JlIHNldHRpbmdzIGFzIHBhcmFtZXRlcnMgKG5vIGhpZGRlblxuICogY2xvY2tzLCBubyBhbWJpZW50IGNvbmZpZykgYW5kIHJldHVybnMgZGV0ZXJtaW5pc3RpY2FsbHkgb3JkZXJlZCByZXN1bHRzXG4gKiAoZXZlcnkgYnVja2V0IHNvcnRlZCBieSBwYXRoOyByZW5hbWVzIGJ5IGBmcm9tYCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBGaWxlU3RhdCwgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XG5pbXBvcnQgeyBpc0lnbm9yZWQsIHR5cGUgSWdub3JlU2V0dGluZ3MgfSBmcm9tICcuL2lnbm9yZS5qcyc7XG5pbXBvcnQgdHlwZSB7IExvY2FsSW5kZXggfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogQSBsb2NhbCBjb250ZW50IGNoYW5nZSBmb3IgYSBwYXRoIHRoYXQgZXhpc3RzIGluIHN0b3JhZ2UuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjYW5DYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG4vKiogQSBsb2NhbCBkZWxldGlvbjogY2FycmllcyB0aGUgaW5kZXgncyB2ZXJzaW9uIHNvIHRoZSB0b21ic3RvbmUgY29tbWl0IG5hbWVzIGl0cyBwYXJlbnQuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZWRDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBIYXNoIG9mIHRoZSBjb250ZW50IGFzIGxhc3Qgc3luY2VkICh0b21ic3RvbmVzIHJldXNlIGl0KS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBWZXJzaW9uIGlkIHRoZSBkZWxldGlvbiBjb21taXQgYnVpbGRzIG9uLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbn1cblxuLyoqIEEgZGV0ZWN0ZWQgcmVuYW1lOiBzYW1lIGNvbnRlbnQgaGFzaCBtb3ZlZCBmcm9tIGBmcm9tYCB0byBgdG9gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZW5hbWVDYW5kaWRhdGUge1xuICBmcm9tOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG4vKiogVGhlIGZ1bGwgcmVzdWx0IG9mIG9uZSBsb2NhbCBzY2FuLiBBbGwgYnVja2V0cyBzb3J0ZWQgYnkgcGF0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxDaGFuZ2VzIHtcbiAgLyoqIFRoZSBgbm93YCBwYXNzZWQgaW4gXHUyMDE0IHdoZW4gdGhpcyBzY2FuIGNvbmNlcHR1YWxseSBoYXBwZW5lZC4gKi9cbiAgc2Nhbm5lZEF0OiBudW1iZXI7XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGF0aHMgdG8gcHVzaCBhcyBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGVtcHR5Rm9sZGVyczogc3RyaW5nW107XG59XG5cbi8qKlxuICogU2NhbiB0aGUgdmF1bHQgYW5kIGRpZmYgaXQgYWdhaW5zdCB0aGUgaW5kZXguXG4gKlxuICogRXZlcnkgbm9uLWlnbm9yZWQgZmlsZSBpcyByZWFkIGFuZCBoYXNoZWQgb24gZXZlcnkgc2NhbiBpbiB2MTsgdXNpbmdcbiAqIHNpemUvbXRpbWUgYXMgYSBoYXNoIHNob3J0Y3V0IGlzIGEgbGF0ZXIgb3B0aW1pemF0aW9uIChjb3JyZWN0bmVzcyBmaXJzdDpcbiAqIGV4dGVybmFsIGVkaXRzIGNhbiBwcmVzZXJ2ZSBtdGltZSkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2FuVmF1bHQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBub3c6IG51bWJlcixcbik6IFByb21pc2U8TG9jYWxDaGFuZ2VzPiB7XG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgc3RvcmFnZS5saXN0RmlsZXMoKTtcblxuICBjb25zdCBrZXB0OiBGaWxlU3RhdFtdID0gW107XG4gIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgIGlmICghaXNJZ25vcmVkKGZpbGUucGF0aCwgc2V0dGluZ3MpKSBrZXB0LnB1c2goZmlsZSk7XG4gIH1cbiAgY29uc3Qga2VwdFBhdGhzID0gbmV3IFNldChrZXB0Lm1hcCgoZikgPT4gZi5wYXRoKSk7XG5cbiAgY29uc3QgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCBtb2RpZmllZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBmaWxlIG9mIGtlcHQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2ZpbGUucGF0aF07XG4gICAgY29uc3QgaGFzaCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKGZpbGUucGF0aCkpO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBhZGRlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyKSB7XG4gICAgICAvLyBBIHJlYWwgZmlsZSByZXBsYWNlZCBhIGZvbGRlciBwbGFjZWhvbGRlcjogdHJlYXQgYXMgY29udGVudCBjaGFuZ2UuXG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVG9tYnN0b25lZCBlbnRyeSB3aXRoIHRoZSBmaWxlIGJhY2sgXHUyMUQyIG1vZGlmaWVkIChyZXN1cnJlY3Qgb3JcbiAgICAvLyBlZGl0LW9mLWRlbGV0ZWQgXHUyMDE0IGJvdGggcmVzb2x2ZSB0aGUgc2FtZSB3YXkgZG93bnN0cmVhbSkuXG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkIHx8IGVudHJ5Lmhhc2ggIT09IGhhc2gpIHtcbiAgICAgIG1vZGlmaWVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZvbGRlciBwbGFjZWhvbGRlcnMgbmV2ZXIgcHJvZHVjZSBmaWxlIGRlbGV0aW9uc1xuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgdG9tYnN0b25lZFxuICAgIGlmIChrZXB0UGF0aHMuaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkge1xuICAgICAgLy8gVGhlIHBhdGggYmVjYW1lIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgXHUyMDE0IG5vdCBhIGRlbGV0aW9uLlxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlbGV0ZWQucHVzaCh7IHBhdGgsIGhhc2g6IGVudHJ5Lmhhc2gsIHNpemU6IGVudHJ5LnNpemUsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG5cbiAgY29uc3QgeyByZW5hbWVkLCBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLCBhZGRlZDogdW5tYXRjaGVkQWRkZWQgfSA9IGRldGVjdFJlbmFtZXMoZGVsZXRlZCwgYWRkZWQpO1xuICBjb25zdCBlbXB0eUZvbGRlcnMgPSBhd2FpdCBkZXRlY3RFbXB0eUZvbGRlcnMoc3RvcmFnZSwgaW5kZXgsIHNldHRpbmdzLCBmaWxlcyk7XG5cbiAgcmV0dXJuIHtcbiAgICBzY2FubmVkQXQ6IG5vdyxcbiAgICBhZGRlZDogc29ydENhbmRpZGF0ZXModW5tYXRjaGVkQWRkZWQpLFxuICAgIG1vZGlmaWVkOiBzb3J0Q2FuZGlkYXRlcyhtb2RpZmllZCksXG4gICAgZGVsZXRlZDogWy4uLnVubWF0Y2hlZERlbGV0ZWRdLnNvcnQoYnlQYXRoKSxcbiAgICByZW5hbWVkOiBbLi4ucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gYnlQYXRoKGEsIGIpKSxcbiAgICBlbXB0eUZvbGRlcnMsXG4gIH07XG59XG5cbi8qKlxuICogQ29ycmVsYXRlIGRlbGV0ZSArIGFkZCBwYWlycyBieSBjb250ZW50IGhhc2ggKEFSQ0hJVEVDVFVSRSBcdTAwQTc0KS5cbiAqXG4gKiBPbmUtdG8tb25lIG1hdGNoaW5nLCBtb3N0IGRldGVybWluaXN0aWMgd2luczogd2hlbiBzZXZlcmFsIHVubWF0Y2hlZCBhZGRzXG4gKiBzaGFyZSB0aGUgZGVsZXRlZCBzaWRlJ3MgaGFzaCwgcHJlZmVyIGFuIGFkZCBpbiB0aGUgc2FtZSBwYXJlbnQgZGlyZWN0b3J5O1xuICogd2l0aGluIGEgcHJlZmVyZW5jZSBjbGFzcywgdGhlIGxleGljb2dyYXBoaWNhbGx5IHNtYWxsZXN0IGB0b2AgcGF0aCB3aW5zLlxuICogTWF0Y2hlZCBwYWlycyBsZWF2ZSB0aGUgZGVsZXRlL2FkZCBidWNrZXRzIGFuZCBiZWNvbWUgYHJlbmFtZWRgLlxuICovXG5mdW5jdGlvbiBkZXRlY3RSZW5hbWVzKFxuICBkZWxldGVkOiByZWFkb25seSBEZWxldGVkQ2FuZGlkYXRlW10sXG4gIGFkZGVkOiByZWFkb25seSBTY2FuQ2FuZGlkYXRlW10sXG4pOiB7XG4gIHJlbmFtZWQ6IFJlbmFtZUNhbmRpZGF0ZVtdO1xuICBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW107XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG59IHtcbiAgY29uc3QgYWRkc0J5SGFzaCA9IG5ldyBNYXA8c3RyaW5nLCBTY2FuQ2FuZGlkYXRlW10+KCk7XG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIFsuLi5hZGRlZF0uc29ydChieVBhdGgpKSB7XG4gICAgY29uc3QgYnVja2V0ID0gYWRkc0J5SGFzaC5nZXQoY2FuZGlkYXRlLmhhc2gpO1xuICAgIGlmIChidWNrZXQpIGJ1Y2tldC5wdXNoKGNhbmRpZGF0ZSk7XG4gICAgZWxzZSBhZGRzQnlIYXNoLnNldChjYW5kaWRhdGUuaGFzaCwgW2NhbmRpZGF0ZV0pO1xuICB9XG5cbiAgY29uc3QgdXNlZEFkZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgdW5tYXRjaGVkRGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBkZWxldGlvbiBvZiBbLi4uZGVsZXRlZF0uc29ydChieVBhdGgpKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGFkZHNCeUhhc2guZ2V0KGRlbGV0aW9uLmhhc2gpID8/IFtdO1xuICAgIGxldCBmYWxsYmFjazogU2NhbkNhbmRpZGF0ZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgc2FtZURpcjogU2NhbkNhbmRpZGF0ZSB8IHVuZGVmaW5lZDtcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICBpZiAodXNlZEFkZHMuaGFzKGNhbmRpZGF0ZS5wYXRoKSkgY29udGludWU7XG4gICAgICBpZiAocGFyZW50UGF0aChjYW5kaWRhdGUucGF0aCkgPT09IHBhcmVudFBhdGgoZGVsZXRpb24ucGF0aCkpIHtcbiAgICAgICAgc2FtZURpciA/Pz0gY2FuZGlkYXRlOyAvLyBzb3J0ZWQgXHUyMUQyIGZpcnN0IGlzIHNtYWxsZXN0XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmYWxsYmFjayA/Pz0gY2FuZGlkYXRlO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBtYXRjaCA9IHNhbWVEaXIgPz8gZmFsbGJhY2s7XG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICB1c2VkQWRkcy5hZGQobWF0Y2gucGF0aCk7XG4gICAgICByZW5hbWVkLnB1c2goeyBmcm9tOiBkZWxldGlvbi5wYXRoLCB0bzogbWF0Y2gucGF0aCwgaGFzaDogZGVsZXRpb24uaGFzaCwgc2l6ZTogZGVsZXRpb24uc2l6ZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdW5tYXRjaGVkRGVsZXRlZC5wdXNoKGRlbGV0aW9uKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHJlbmFtZWQsXG4gICAgZGVsZXRlZDogdW5tYXRjaGVkRGVsZXRlZCxcbiAgICBhZGRlZDogYWRkZWQuZmlsdGVyKChjYW5kaWRhdGUpID0+ICF1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcmllcyB0aGF0IGV4aXN0IGluIHN0b3JhZ2UgYnV0IGFyZSByZXByZXNlbnRlZCBuZWl0aGVyIGJ5IGEgbGl2ZVxuICogZm9sZGVyIHBsYWNlaG9sZGVyIGluIHRoZSBpbmRleCBub3IgYnkgYW55IGZpbGUgKGlnbm9yZWQgb3Igbm90KSBiZW5lYXRoXG4gKiB0aGVtLiBBIGRpcmVjdG9yeSBjb250YWluaW5nIG9ubHkgaWdub3JlZCBmaWxlcyBpcyB0aGVyZWZvcmUgKm5vdCogZW1wdHkgXHUyMDE0XG4gKiBpdCBpcyByZXByZXNlbnRlZCBieSB0aG9zZSBmaWxlcyBhcyBmYXIgYXMgdGhlIGxvY2FsIG1hY2hpbmUgaXMgY29uY2VybmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZXRlY3RFbXB0eUZvbGRlcnMoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBmaWxlczogcmVhZG9ubHkgRmlsZVN0YXRbXSxcbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcmVwcmVzZW50ZWREaXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgIGZvciAobGV0IGRpciA9IHBhcmVudFBhdGgoZmlsZS5wYXRoKTsgZGlyICE9PSAnLyc7IGRpciA9IHBhcmVudFBhdGgoZGlyKSkge1xuICAgICAgcmVwcmVzZW50ZWREaXJzLmFkZChkaXIpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGVtcHR5Rm9sZGVyczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBkaXIgb2YgYXdhaXQgc3RvcmFnZS5saXN0RGlycygpKSB7XG4gICAgaWYgKGRpciA9PT0gJy8nKSBjb250aW51ZTtcbiAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKGRpciwgc2V0dGluZ3MpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2Rpcl07XG4gICAgaWYgKGVudHJ5Py5pc0ZvbGRlciAmJiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgc3luY2VkIGFzIHBsYWNlaG9sZGVyXG4gICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgfVxuICByZXR1cm4gZW1wdHlGb2xkZXJzLnNvcnQoKTtcbn1cblxuZnVuY3Rpb24gc29ydENhbmRpZGF0ZXMoY2FuZGlkYXRlczogU2NhbkNhbmRpZGF0ZVtdKTogU2NhbkNhbmRpZGF0ZVtdIHtcbiAgcmV0dXJuIFsuLi5jYW5kaWRhdGVzXS5zb3J0KGJ5UGF0aCk7XG59XG5cbmZ1bmN0aW9uIGJ5UGF0aDxUIGV4dGVuZHMgeyBwYXRoPzogc3RyaW5nOyBmcm9tPzogc3RyaW5nIH0+KGE6IFQsIGI6IFQpOiBudW1iZXIge1xuICBjb25zdCBrZXlBID0gYS5wYXRoID8/IGEuZnJvbSA/PyAnJztcbiAgY29uc3Qga2V5QiA9IGIucGF0aCA/PyBiLmZyb20gPz8gJyc7XG4gIHJldHVybiBrZXlBIDwga2V5QiA/IC0xIDoga2V5QSA+IGtleUIgPyAxIDogMDtcbn1cbiIsICIvKipcbiAqIGBTeW5jQ2xpZW50YCBcdTIwMTQgdGhlIG5ldHdvcmstZmFjaW5nIG9yY2hlc3RyYXRvciAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxuICpcbiAqIENvbXBvc2VzIHRoZSBwaGFzZS0xYS8xYiBwaWVjZXMgaW50byBvbmUgbG9vcCBwZXIgZGV2aWNlOlxuICpcbiAqICAgc3RhcnR1cDogIGxvYWRMb2NhbEluZGV4IFx1MjE5MiBoZWxsby9oZWxsb0FjayBcdTIxOTIgZ2V0TWFuaWZlc3QgXHUyMTkyIHNjYW5WYXVsdCBcdTIxOTJcbiAqICAgICAgICAgICAgIGNvbXB1dGVTeW5jUGxhbiBcdTIxOTIgZXhlY3V0ZSAocHVzaGVzIGlubGluZS1vci1ibG9iLCBwdWxscyB2aWFcbiAqICAgICAgICAgICAgIGFwcGx5UHVsbCB3aXRoIHRoZSBpbmplY3RlZCBibG9iIHN0b3JlKTtcbiAqICAgbGl2ZTogICAgIGBjaGFuZ2VgIG1lc3NhZ2VzIG1hdGVyaWFsaXplIGltbWVkaWF0ZWx5IHdoZW4gdGhlIHRhcmdldCBpc1xuICogICAgICAgICAgICAgY2xlYW4sIGFuZCBkZWZlciB0byBhIGZ1bGwgcmVjb25jaWxlIGN5Y2xlIHdoZW4gaXQgaXMgbm90IFx1MjAxNCBhXG4gKiAgICAgICAgICAgICByZW1vdGUgY2hhbmdlIGlzIE5FVkVSIHdyaXR0ZW4gb3ZlciBsb2NhbGx5LW1vZGlmaWVkIGNvbnRlbnRcbiAqICAgICAgICAgICAgIHdpdGhvdXQgZ29pbmcgdGhyb3VnaCBgY29tcHV0ZVN5bmNQbGFuYCdzIGNvbmZsaWN0IGxvZ2ljO1xuICogICB3YXRjaGVyOiAgYFdhdGNoQWRhcHRlcmAgYmF0Y2hlcyBhcmUgZGVib3VuY2VkICh+MzAwIG1zLCBpbmplY3RhYmxlXG4gKiAgICAgICAgICAgICBzY2hlZHVsZXIgXHUyMDE0IG5vIGFtYmllbnQgdGltZXJzIGluIHRlc3RzKSBpbnRvIHNjYW5cdTIxOTJwbGFuXHUyMTkyZXhlY3V0ZTtcbiAqICAgcmVjb25uZWN0OiBgb25DbG9zZWAgZmxpcHMgdG8gYCdkaXNjb25uZWN0ZWQnYDsgYHJlY29ubmVjdCgpYCByZS1ydW5zIHRoZVxuICogICAgICAgICAgICAgd2hvbGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAoYmFja29mZiBpcyB0aGUgY2FsbGVyJ3Mgam9iKS5cbiAqXG4gKiBBbGwgSS9PIGNyb3NzZXMgdGhlIGFkYXB0ZXIgc2VhbXMgKGBTdG9yYWdlQWRhcHRlcmAsIGBUcmFuc3BvcnRgLFxuICogYEJsb2JTdG9yZWAsIGBMb2dBZGFwdGVyYCk7IHRoZSBjbGFzcyBpdHNlbGYgaXMgcHVyZSBvcmNoZXN0cmF0aW9uIGFuZCBydW5zXG4gKiBhbnl3aGVyZSBgY29yZWAgcnVucyBcdTIwMTQgV29ya2VycyB0ZXN0cyBpbmNsdWRlZC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ0FkYXB0ZXIsIFN0b3JhZ2VBZGFwdGVyLCBXYXRjaEFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IGNvbXBhcmVDbG9ja3MgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGFwcGx5UHVsbCwgbG9hZExvY2FsSW5kZXgsIHR5cGUgRmV0Y2hCbG9iIH0gZnJvbSAnLi9lbmdpbmUuanMnO1xuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBQcm90b2NvbEVycm9yLCBSZXZva2VkRXJyb3IsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7IGlzSWdub3JlZCwgdHlwZSBJZ25vcmVTZXR0aW5ncyB9IGZyb20gJy4vaWdub3JlLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICByZW1vdmVFbnRyeSxcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgdHlwZSBMb2NhbEluZGV4LFxufSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHtcbiAgYmFzZTY0VG9CeXRlcyxcbiAgYnl0ZXNUb0Jhc2U2NCxcbiAgSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTLFxuICBQcm90b2NvbFZlcnNpb24sXG4gIHR5cGUgQmxvYkFja01lc3NhZ2UsXG4gIHR5cGUgQmxvYk1lc3NhZ2UsXG4gIHR5cGUgQ2hhbmdlTWVzc2FnZSxcbiAgdHlwZSBDb21taXRBY2tNZXNzYWdlLFxuICB0eXBlIENvbW1pdE1lc3NhZ2UsXG4gIHR5cGUgQ29uZmxpY3RNZXNzYWdlLFxuICB0eXBlIEhlbGxvQWNrTWVzc2FnZSxcbiAgdHlwZSBNYW5pZmVzdE1lc3NhZ2UsXG4gIHR5cGUgTWVzc2FnZSxcbiAgdHlwZSBTZXJ2ZXJNZXNzYWdlLFxufSBmcm9tICcuL3Byb3RvY29sLmpzJztcbmltcG9ydCB7XG4gIGNvbXB1dGVTeW5jUGxhbixcbiAgdHlwZSBDb25mbGljdE9wLFxuICB0eXBlIFB1bGxGaWxlT3AsXG4gIHR5cGUgUHVsbE9wLFxuICB0eXBlIFB1c2hPcCxcbiAgdHlwZSBSZW1vdGVGaWxlLFxuICB0eXBlIFN5bmNQbGFuLFxufSBmcm9tICcuL3Jlc29sdmUuanMnO1xuaW1wb3J0IHsgc2NhblZhdWx0IH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgVHJhbnNwb3J0IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLy8gLS0tIHB1YmxpYyBvcHRpb24vc3RhdHVzIHNoYXBlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQ2xpZW50LXNpZGUgY29udGVudC1hZGRyZXNzZWQgYmxvYiBjYWNoZSAoUjIgY2xpZW50IGluIHByb2R1Y3Rpb247IGEgTWFwIGluIHRlc3RzKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYlN0b3JlIHtcbiAgZ2V0KGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD47XG4gIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jQ2xpZW50T3B0aW9ucyB7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIEEgZmFjdG9yeSAocmVjb25uZWN0IGRpYWxzIGZyZXNoKSBvciBhIHNpbmdsZSByZXVzYWJsZSBpbnN0YW5jZS4gKi9cbiAgdHJhbnNwb3J0OiAoKCkgPT4gVHJhbnNwb3J0KSB8IFRyYW5zcG9ydDtcbiAgYmxvYlN0b3JlOiBCbG9iU3RvcmU7XG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyO1xuICBsb2c/OiBMb2dBZGFwdGVyO1xuICAvKiogSW5pdGlhbCBpZ25vcmUgc2V0dGluZ3M7IHN1cGVyc2VkZWQgYnkgYGhlbGxvQWNrLnNldHRpbmdzYCBvbiBjb25uZWN0LiAqL1xuICBzZXR0aW5ncz86IElnbm9yZVNldHRpbmdzO1xuICAvKiogSW5qZWN0YWJsZSBjbG9jayAoZGVmYXVsdCBgRGF0ZS5ub3dgKS4gKi9cbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogV2F0Y2hlciBkZWJvdW5jZSB3aW5kb3cgaW4gbXMgKGRlZmF1bHQgMzAwKS4gKi9cbiAgZGVib3VuY2VNcz86IG51bWJlcjtcbiAgLyoqXG4gICAqIFNjaGVkdWxlcyB0aGUgZGVib3VuY2VkIHN5bmMgY3ljbGUuIERlZmF1bHQ6IGBzZXRUaW1lb3V0YC4gVGVzdHMgaW5qZWN0IGFcbiAgICogbWFudWFsIHF1ZXVlIFx1MjAxNCB0aGUgY2xpZW50IG5ldmVyIHRvdWNoZXMgYSByZWFsIHRpbWVyIGJlaGluZCB0aGlzIHNlYW0uXG4gICAqL1xuICBzY2hlZHVsZT86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IHR5cGUgU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnIHwgJ2Nvbm5lY3RpbmcnIHwgJ3N5bmNpbmcnIHwgJ2xpdmUnIHwgJ2Rpc2Nvbm5lY3RlZCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudFN0YXR1cyB7XG4gIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGU7XG4gIC8qKiBFcG9jaCBtcyBvZiB0aGUgbGFzdCBjb21wbGV0ZWQgY3ljbGUsIG9yIG51bGwgYmVmb3JlIHRoZSBmaXJzdC4gKi9cbiAgbGFzdFN5bmNBdDogbnVtYmVyIHwgbnVsbDtcbiAgLyoqIFdhdGNoZXIvcmVjb25jaWxlIGV2ZW50cyBxdWV1ZWQgYmVoaW5kIHRoZSBkZWJvdW5jZSB3aW5kb3cuICovXG4gIHBlbmRpbmc6IG51bWJlcjtcbiAgLyoqIENvbmZsaWN0cyBvYnNlcnZlZCBieSBwbGFuIGN5Y2xlcyAoaW5mb3JtYXRpb25hbDsgcmVzb2x1dGlvbiBpcyBpbiB0aGUgZGF0YSkuICovXG4gIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdO1xufVxuXG5jb25zdCBkZWZhdWx0TG9nOiBMb2dBZGFwdGVyID0ge1xuICBkZWJ1ZzogKCkgPT4ge30sXG4gIGluZm86ICgpID0+IHt9LFxuICB3YXJuOiAoKSA9PiB7fSxcbiAgZXJyb3I6ICgpID0+IHt9LFxufTtcblxuY29uc3QgZGVmYXVsdFNjaGVkdWxlID0gKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKTogKCgpID0+IHZvaWQpID0+IHtcbiAgY29uc3QgaGFuZGxlID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KGZuLCBtcykgYXMgdW5rbm93biBhcyBudW1iZXI7XG4gIHJldHVybiAoKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dChoYW5kbGUpO1xufTtcblxuLyoqIEEgY29tbWl0IHByZXBhcmVkIGZvciB0aGUgd2lyZSAoYSBgUHVzaE9wYCArIGl0cyBzdGFnZWQgY29udGVudCkuICovXG5pbnRlcmZhY2UgU3RhZ2VkQ29tbWl0IHtcbiAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xuICBwYXRoOiBzdHJpbmc7XG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICBieXRlcz86IFVpbnQ4QXJyYXk7XG59XG5cbi8vIC0tLSB0aGUgY2xpZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgY2xhc3MgU3luY0NsaWVudCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogU3luY0NsaWVudE9wdGlvbnM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nOiBMb2dBZGFwdGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IG5vdzogKCkgPT4gbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlYm91bmNlTXM6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBzY2hlZHVsZTogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiAoKSA9PiB2b2lkO1xuICBwcml2YXRlIHJlYWRvbmx5IGRpYWxUcmFuc3BvcnQ6ICgpID0+IFRyYW5zcG9ydDtcblxuICBwcml2YXRlIHRyYW5zcG9ydDogVHJhbnNwb3J0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdGU6IFN5bmNDbGllbnRTdGF0ZSA9ICdpZGxlJztcbiAgcHJpdmF0ZSBpbmRleDogTG9jYWxJbmRleCA9IHt9O1xuICBwcml2YXRlIGN1cnNvciA9IDA7XG4gIHByaXZhdGUgbGFzdFN5bmNBdDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZyA9IDA7XG4gIHByaXZhdGUgY29uZmxpY3RzOiBDb25mbGljdE9wW10gPSBbXTtcbiAgcHJpdmF0ZSBpZ25vcmVTZXR0aW5nczogSWdub3JlU2V0dGluZ3M7XG4gIHByaXZhdGUgd2F0Y2hBZGFwdGVyOiBXYXRjaEFkYXB0ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjYW5jZWxEZWJvdW5jZTogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFNlcmlhbGl6ZWQgb3BlcmF0aW9uIHF1ZXVlIFx1MjAxNCBleGFjdGx5IG9uZSBhc3luYyBvcCBydW5zIGF0IGEgdGltZS4gKi9cbiAgcHJpdmF0ZSB0YWlsOiBQcm9taXNlPHVua25vd24+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHByaXZhdGUgcXVldWVkT3BzID0gMDtcbiAgLyoqIFN0YXJ0dXAtdGltZSBjaGFuZ2UgZmxvb2QgaXMgYnVmZmVyZWQ7IHRoZSBmdWxsIG1hbmlmZXN0IHN1YnN1bWVzIGl0LiAqL1xuICBwcml2YXRlIGJ1ZmZlcmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGJ1ZmZlcmVkOiBNZXNzYWdlW10gPSBbXTtcbiAgLyoqIFNpbmdsZSBvdXRzdGFuZGluZyByZXF1ZXN0IGV4cGVjdGF0aW9uIChvcHMgYXJlIHNlcmlhbGl6ZWQpLiAqL1xuICBwcml2YXRlIGV4cGVjdGF0aW9uOiB7XG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW47XG4gICAgcmVzb2x2ZTogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQ7XG4gICAgcmVqZWN0OiAoZXJyb3I6IEVycm9yKSA9PiB2b2lkO1xuICB9IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogU3luY0NsaWVudE9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMubG9nID0gb3B0aW9ucy5sb2cgPz8gZGVmYXVsdExvZztcbiAgICB0aGlzLm5vdyA9IG9wdGlvbnMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgICB0aGlzLmRlYm91bmNlTXMgPSBvcHRpb25zLmRlYm91bmNlTXMgPz8gMzAwO1xuICAgIHRoaXMuc2NoZWR1bGUgPSBvcHRpb25zLnNjaGVkdWxlID8/IGRlZmF1bHRTY2hlZHVsZTtcbiAgICB0aGlzLmRpYWxUcmFuc3BvcnQgPVxuICAgICAgdHlwZW9mIG9wdGlvbnMudHJhbnNwb3J0ID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gb3B0aW9ucy50cmFuc3BvcnRcbiAgICAgICAgOiAoKSA9PiBvcHRpb25zLnRyYW5zcG9ydCBhcyBUcmFuc3BvcnQ7XG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IG9wdGlvbnMuc2V0dGluZ3MgPz8geyBvYnNpZGlhblN5bmM6IGZhbHNlIH07XG4gIH1cblxuICAvLyAtLS0gbGlmZWN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogUnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gYW5kIGVudGVyIGxpdmUgbW9kZS4gKi9cbiAgYXN5bmMgY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5zdGFydHVwKCkpO1xuICB9XG5cbiAgLyoqIFJlLWRpYWwgYW5kIHJlLXJ1biB0aGUgZnVsbCBzdGFydHVwIHJlY29uY2lsaWF0aW9uLiAqL1xuICBhc3luYyByZWNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMudHJhbnNwb3J0Py5jbG9zZSgpO1xuICAgICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xuICAgICAgYXdhaXQgdGhpcy5zdGFydHVwKCk7XG4gICAgfSk7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xuICAgIHRoaXMuY2FuY2VsRGVib3VuY2U/LigpO1xuICAgIHRoaXMuY2FuY2VsRGVib3VuY2UgPSBudWxsO1xuICAgIHRoaXMudHJhbnNwb3J0Py5jbG9zZSgpO1xuICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcbiAgICB0aGlzLnN0YXRlID0gJ2lkbGUnO1xuICB9XG5cbiAgLyoqIEJlZ2luIGRlYm91bmNlZCB3YXRjaGluZyAoQVJDSElURUNUVVJFIFx1MDBBNzggbGl2ZSBvcGVyYXRpb24pLiAqL1xuICBzdGFydFdhdGNoaW5nKHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcbiAgICB0aGlzLndhdGNoQWRhcHRlciA9IHdhdGNoQWRhcHRlcjtcbiAgICB3YXRjaEFkYXB0ZXIuc3RhcnQoKGV2ZW50cykgPT4gdGhpcy5vbldhdGNoRXZlbnRzKGV2ZW50cykpO1xuICB9XG5cbiAgc3RvcFdhdGNoaW5nKCk6IHZvaWQge1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyPy5zdG9wKCk7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSBudWxsO1xuICB9XG5cbiAgLyoqIE1hbnVhbCBvbmUtc2hvdCBjeWNsZSAoYHZzYWAgb25lLXNob3QsIFwic3luYyBub3dcIiBidXR0b25zLCB0ZXN0cykuICovXG4gIGFzeW5jIHRyaWdnZXJTeW5jKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpO1xuICB9XG5cbiAgLyoqIFJlc29sdmVzIHdoZW4gZXZlcnkgcXVldWVkIG9wZXJhdGlvbiBoYXMgc2V0dGxlZC4gKi9cbiAgYXN5bmMgd2FpdElkbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgd2hpbGUgKHRoaXMucXVldWVkT3BzID4gMCkgYXdhaXQgdGhpcy50YWlsO1xuICAgIGF3YWl0IHRoaXMudGFpbDtcbiAgfVxuXG4gIHN0YXR1cygpOiBTeW5jQ2xpZW50U3RhdHVzIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXG4gICAgICBsYXN0U3luY0F0OiB0aGlzLmxhc3RTeW5jQXQsXG4gICAgICBwZW5kaW5nOiB0aGlzLnBlbmRpbmcsXG4gICAgICBjb25mbGljdHM6IFsuLi50aGlzLmNvbmZsaWN0c10sXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBSZWFkLW9ubHkgdmlldyBvZiB0aGUgbG9jYWwgaW5kZXggKHRlc3RzLCBgdnNhIHN0YXR1c2ApLiAqL1xuICBjdXJyZW50SW5kZXgoKTogTG9jYWxJbmRleCB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5pbmRleCB9O1xuICB9XG5cbiAgLyoqIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UgbnVtYmVyLiAqL1xuICBnZXQgY3Vyc29yVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5jdXJzb3I7XG4gIH1cblxuICAvKiogVFMtc2FmZSBzdGF0ZSBwcm9iZSAoYXNzaWdubWVudHMgaW5zaWRlIGFzeW5jIGZsb3dzIGRlZmVhdCBuYXJyb3dpbmcpLiAqL1xuICBwcml2YXRlIGlzRGlzY29ubmVjdGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJztcbiAgfVxuXG4gIC8vIC0tLSBzdGFydHVwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXJ0dXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zdGF0ZSA9ICdjb25uZWN0aW5nJztcbiAgICB0aGlzLmJ1ZmZlcmluZyA9IHRydWU7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuXG4gICAgdGhpcy5pbmRleCA9IChhd2FpdCB0aGlzLnNhZmVTdG9yYWdlRXhpc3RzKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpKVxuICAgICAgPyBhd2FpdCBsb2FkTG9jYWxJbmRleCh0aGlzLm9wdGlvbnMuc3RvcmFnZSlcbiAgICAgIDoge307XG5cbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLmRpYWxUcmFuc3BvcnQoKTtcbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQub25NZXNzYWdlKChtZXNzYWdlKSA9PiB0aGlzLm9uVHJhbnNwb3J0TWVzc2FnZShtZXNzYWdlKSk7XG4gICAgdHJhbnNwb3J0Lm9uQ2xvc2UoKHJlYXNvbikgPT4gdGhpcy5vblRyYW5zcG9ydENsb3NlKHJlYXNvbikpO1xuXG4gICAgY29uc3QgaGVsbG9BY2sgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8SGVsbG9BY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdoZWxsb0FjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT5cbiAgICAgICAgdHJhbnNwb3J0LnNlbmQoe1xuICAgICAgICAgIHR5cGU6ICdoZWxsbycsXG4gICAgICAgICAgdG9rZW46IHRoaXMub3B0aW9ucy50b2tlbixcbiAgICAgICAgICBwcm90b2NvbFZlcnNpb246IFByb3RvY29sVmVyc2lvbixcbiAgICAgICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgICB9KSxcbiAgICApO1xuICAgIGlmIChoZWxsb0Fjay50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IoaGVsbG9BY2spO1xuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSB7IG9ic2lkaWFuU3luYzogaGVsbG9BY2suc2V0dGluZ3Mub2JzaWRpYW5TeW5jIH07XG5cbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xuICAgIGF3YWl0IHRoaXMucnVuQ3ljbGUoKTtcblxuICAgIHRoaXMuYnVmZmVyaW5nID0gZmFsc2U7XG4gICAgY29uc3QgYnVmZmVyZWQgPSB0aGlzLmJ1ZmZlcmVkO1xuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgYnVmZmVyZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfVxuICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYWZlU3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG9uVHJhbnNwb3J0Q2xvc2UocmVhc29uOiB7IGNvZGU/OiBudW1iZXI7IHJlYXNvbj86IHN0cmluZyB9KTogdm9pZCB7XG4gICAgdGhpcy5sb2cud2FybigndHJhbnNwb3J0IGNsb3NlZCcsIHJlYXNvbik7XG4gICAgdGhpcy5zdGF0ZSA9ICdkaXNjb25uZWN0ZWQnO1xuICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbjtcbiAgICBpZiAoZXhwZWN0YXRpb24gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuZXhwZWN0YXRpb24gPSBudWxsO1xuICAgICAgZXhwZWN0YXRpb24ucmVqZWN0KFxuICAgICAgICBuZXcgTmV0d29ya0Vycm9yKGBjb25uZWN0aW9uIGNsb3NlZDogJHtyZWFzb24ucmVhc29uID8/IHJlYXNvbi5jb2RlID8/ICd1bmtub3duJ31gKSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIG1lc3NhZ2UgcHVtcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydE1lc3NhZ2UgPSAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbjtcbiAgICBpZiAoZXhwZWN0YXRpb24gIT09IG51bGwgJiYgZXhwZWN0YXRpb24ubWF0Y2hlcyhtZXNzYWdlKSkge1xuICAgICAgdGhpcy5leHBlY3RhdGlvbiA9IG51bGw7XG4gICAgICBleHBlY3RhdGlvbi5yZXNvbHZlKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXJpbmcpIHtcbiAgICAgIHRoaXMuYnVmZmVyZWQucHVzaChtZXNzYWdlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdjaGFuZ2UgaGFuZGxlciBmYWlsZWQnLCBlcnJvcikpO1xuICB9O1xuXG4gIHByaXZhdGUgYXN5bmMgZGlzcGF0Y2gobWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHN3aXRjaCAobWVzc2FnZS50eXBlKSB7XG4gICAgICBjYXNlICdjaGFuZ2UnOlxuICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZUNoYW5nZShtZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGV2aWNlU2Vlbic6XG4gICAgICAgIHJldHVybjsgLy8gcHJlc2VuY2Ugb25seTsgZGFzaGJvYXJkcyBjb25zdW1lIGl0XG4gICAgICBjYXNlICdwb25nJzpcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICB0aGlzLmxvZy5lcnJvcignc2VydmVyIGVycm9yJywgbWVzc2FnZS5jb2RlLCBtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdoZWxsb0Fjayc6XG4gICAgICBjYXNlICdtYW5pZmVzdCc6XG4gICAgICBjYXNlICdjb21taXRBY2snOlxuICAgICAgY2FzZSAnY29uZmxpY3QnOlxuICAgICAgY2FzZSAnYmxvYic6XG4gICAgICBjYXNlICdibG9iQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIGlmIChpc0lnbm9yZWQoY2hhbmdlLnBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG5cbiAgICAvLyBTdGFsZSByZXBsYXkgLyBkdXBsaWNhdGUgZmFuLW91dDogcGVyIHBhdGggdGhlIGhlYWQgY2xvY2sgZG9taW5hdGVzXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgaWYgKGVudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jaGFuZ2VJc1NhZmUoY2hhbmdlKSkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcbiAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLnB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlKV0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xuICAgKiB1bi1yZWNvbmNpbGVkIGxvY2FsIGNvbnRlbnQuIEFueXRoaW5nIGVsc2UgbXVzdCBkZXRvdXIgdGhyb3VnaCBhIGZ1bGxcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjaGFuZ2VJc1NhZmUoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UuZnJvbVBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgICAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiAhKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UucGF0aCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXRoSGFzTG9jYWxEaXZlcmdlbmNlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xuICAgIHJldHVybiBhY3R1YWwgIT09IGVudHJ5Lmhhc2g7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBjaGFuZ2UuZnJvbVBhdGgsXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxuICAgICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxuICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxuICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIE1hdGVyaWFsaXplIHB1bGxzIHRocm91Z2ggdGhlIHZlcmlmaWVkIGVuZ2luZSBwYXRoOyByZXR1cm5zIHRoZSBuZXcgaW5kZXguICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+KTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gICAgcmV0dXJuIGFwcGx5UHVsbChcbiAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgdGhpcy5pbmRleCxcbiAgICAgIHsgcHVzaGVzOiBbXSwgcHVsbHM6IFsuLi5wdWxsc10sIGNvbmZsaWN0czogW10sIGZvbGRlclB1c2hlczogW10gfSxcbiAgICAgIHRoaXMuZmV0Y2hCbG9iLFxuICAgICAgeyBub3c6IHRoaXMubm93KCkgfSxcbiAgICApO1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXG4gICAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgICB0aGlzLmluZGV4LFxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxuICAgICAgICB0aGlzLm5vdygpLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHBsYW4gPSBjb21wdXRlU3luY1BsYW4oe1xuICAgICAgICBsb2NhbENoYW5nZXMsXG4gICAgICAgIGluZGV4OiB0aGlzLmluZGV4LFxuICAgICAgICBtYW5pZmVzdCxcbiAgICAgICAgdGhpc0RldmljZUlkOiB0aGlzLm9wdGlvbnMuZGV2aWNlSWQsXG4gICAgICAgIHRoaXNEZXZpY2VOYW1lOiB0aGlzLm9wdGlvbnMuZGV2aWNlTmFtZSxcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgfSk7XG4gICAgICB0aGlzLmNvbmZsaWN0cyA9IFsuLi50aGlzLmNvbmZsaWN0cywgLi4ucGxhbi5jb25mbGljdHNdO1xuXG4gICAgICAvLyBTdGFnZSBwdXNoIGNvbnRlbnRzIEJFRk9SRSBwdWxscyBvdmVyd3JpdGUgdGhlIHdvcmtpbmcgdHJlZSAoYVxuICAgICAgLy8gY29uZmxpY3QtY29weSBwdXNoIHJlYWRzIHRoZSBsb3NlciBjb250ZW50IGZyb20gdGhlIG9yaWdpbmFsIHBhdGgpLlxuICAgICAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgdGhpcy5zdGFnZVB1c2hlcyhwbGFuKTtcblxuICAgICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhwbGFuLnB1bGxzKTtcblxuICAgICAgZm9yIChjb25zdCBjb21taXQgb2Ygc3RhZ2VkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIHBsYW4uZm9sZGVyUHVzaGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdCh7XG4gICAgICAgICAga2luZDogJ2VkaXQnLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogdGhpcy5pbmRleFtwYXRoXT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogJycsXG4gICAgICAgICAgc2l6ZTogMCxcbiAgICAgICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubGFzdFN5bmNBdCA9IHRoaXMubm93KCk7XG4gICAgICB0aGlzLnBlbmRpbmcgPSAwO1xuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nLmVycm9yKCdzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gdGhpcy50cmFuc3BvcnQgIT09IG51bGwgPyAnbGl2ZScgOiAnaWRsZSc7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTWFuaWZlc3QoKTogUHJvbWlzZTxSZW1vdGVGaWxlW10+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdtYW5pZmVzdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgaWYgKHJlcGx5LmN1cnNvciA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LmN1cnNvcjtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyhyZXBseS5lbnRyaWVzKS5tYXAoKGVudHJ5KSA9PiAoeyAuLi5lbnRyeSB9KSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0YWdlUHVzaGVzKHBsYW46IFN5bmNQbGFuKTogUHJvbWlzZTxTdGFnZWRDb21taXRbXT4ge1xuICAgIC8vIEEgY29uZmxpY3QtY29weSBwdXNoIGNhcnJpZXMgY29udGVudCByZWFkIGZyb20gdGhlICpvcmlnaW5hbCogcGF0aC5cbiAgICBjb25zdCBjb3B5U291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBjb25mbGljdCBvZiBwbGFuLmNvbmZsaWN0cykge1xuICAgICAgaWYgKGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb3B5U291cmNlcy5zZXQoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCwgY29uZmxpY3QucGF0aCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhZ2VkOiBTdGFnZWRDb21taXRbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgcHVzaCBvZiBwbGFuLnB1c2hlcykge1xuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2RlbGV0ZScgfHwgcHVzaC5raW5kID09PSAncmVuYW1lJykge1xuICAgICAgICBzdGFnZWQucHVzaCh0aGlzLnRvU3RhZ2VkKHB1c2gpKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzb3VyY2VQYXRoID1cbiAgICAgICAgcHVzaC5raW5kID09PSAnY29uZmxpY3RDb3B5JyA/IGNvcHlTb3VyY2VzLmdldChwdXNoLnBhdGgpID8/IHB1c2gucGF0aCA6IHB1c2gucGF0aDtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoc291cmNlUGF0aCk7XG4gICAgICBpZiAoYnl0ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdwdXNoIHNvdXJjZSB2YW5pc2hlZCBzaW5jZSBzY2FuOyBkZWZlcnJpbmcnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgaGFzaCA9IGF3YWl0IHNoYTI1NkhleChieXRlcyk7XG4gICAgICBpZiAoaGFzaCAhPT0gcHVzaC5oYXNoIHx8IGJ5dGVzLmJ5dGVMZW5ndGggIT09IHB1c2guc2l6ZSkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdsb2NhbCBjb250ZW50IGRyaWZ0ZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nIHB1c2gnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScpIHtcbiAgICAgICAgLy8gTWF0ZXJpYWxpemUgdGhlIGNvcHkgbG9jYWxseSBOT1csIGJlZm9yZSB0aGUgcHVsbHMgb3ZlcndyaXRlIHRoZVxuICAgICAgICAvLyBvcmlnaW5hbDogdGhlIHNlcnZlciBicm9hZGNhc3RzIHRoZSBjb3B5IHRvICpvdGhlciogY2xpZW50cyBvbmx5LFxuICAgICAgICAvLyBzbyB0aGlzIGRldmljZSBtdXN0IHdyaXRlIGl0cyBvd24gY29weSBpdHNlbGYuXG4gICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLndyaXRlRmlsZShwdXNoLnBhdGgsIGJ5dGVzKTtcbiAgICAgIH1cbiAgICAgIHN0YWdlZC5wdXNoKHsgLi4udGhpcy50b1N0YWdlZChwdXNoKSwgYnl0ZXMgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGFnZWQ7XG4gIH1cblxuICBwcml2YXRlIHRvU3RhZ2VkKHB1c2g6IFB1c2hPcCk6IFN0YWdlZENvbW1pdCB7XG4gICAgaWYgKHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBwYXRoOiBwdXNoLnRvUGF0aCxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgICBoYXNoOiBwdXNoLmhhc2gsXG4gICAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgICAgZnJvbVBhdGg6IHB1c2guZnJvbVBhdGgsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAga2luZDogcHVzaC5raW5kID09PSAnYWRkJyA/ICdlZGl0JyA6IHB1c2gua2luZCxcbiAgICAgIHBhdGg6IHB1c2gucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkTG9jYWwocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShwYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ29tbWl0KGNvbW1pdDogU3RhZ2VkQ29tbWl0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogQ29tbWl0TWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6ICdjb21taXQnLFxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBjb21taXQucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBraW5kOiBjb21taXQua2luZCxcbiAgICAgIC4uLihjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCA/IHsgZnJvbVBhdGg6IGNvbW1pdC5mcm9tUGF0aCB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNcbiAgICAgICAgPyB7IGlubGluZTogYnl0ZXNUb0Jhc2U2NChjb21taXQuYnl0ZXMpIH1cbiAgICAgICAgOiB7fSksXG4gICAgfTtcblxuICAgIC8vIEF0dGFjaG1lbnRzIGFib3ZlIHRoZSBpbmxpbmUgY2FwIHJpZGUgdGhlIGJsb2Igc3RvcmUgKEZSLTgpLlxuICAgIGlmIChjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA+IElOTElORV9DT05URU5UX01BWF9CWVRFUykge1xuICAgICAgYXdhaXQgdGhpcy51cGxvYWRCbG9iKGNvbW1pdC5oYXNoLCBjb21taXQuYnl0ZXMpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PENvbW1pdEFja01lc3NhZ2UgfCBDb25mbGljdE1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2NvbW1pdEFjaycgfHwgbS50eXBlID09PSAnY29uZmxpY3QnIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG5cbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2NvbW1pdEFjaycpIHtcbiAgICAgIGlmIChyZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XG4gICAgICB0aGlzLmFwcGx5QWNrVG9JbmRleChjb21taXQsIHJlcGx5LnZlcnNpb24sIHJlcGx5LmNsb2NrKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5oYW5kbGVDb25mbGljdFJlcGx5KGNvbW1pdCwgcmVwbHkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUFja1RvSW5kZXgoY29tbWl0OiBTdGFnZWRDb21taXQsIHZlcnNpb25JZDogc3RyaW5nLCBjbG9jazogTG9naWNhbENsb2NrKTogdm9pZCB7XG4gICAgY29uc3QgZGVsZXRlZCA9IGNvbW1pdC5raW5kID09PSAnZGVsZXRlJztcbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQocmVtb3ZlRW50cnkodGhpcy5pbmRleCwgY29tbWl0LmZyb21QYXRoKSwge1xuICAgICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgICAgdmVyc2lvbklkLFxuICAgICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICAgIGNsb2NrLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdCh0aGlzLmluZGV4LCB7XG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgIHZlcnNpb25JZCxcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBjbG9jayxcbiAgICAgIGRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IGRlbGV0ZWQgPyB0aGlzLm5vdygpIDogdW5kZWZpbmVkLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ29uZmxpY3RSZXBseShcbiAgICBjb21taXQ6IFN0YWdlZENvbW1pdCxcbiAgICByZXBseTogQ29uZmxpY3RNZXNzYWdlLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAocmVwbHkuc2VxICE9PSB1bmRlZmluZWQgJiYgcmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgIGNvbnN0IHdlV29uID1cbiAgICAgIHJlcGx5Lndpbm5lci5kZXZpY2VJZCA9PT0gdGhpcy5vcHRpb25zLmRldmljZUlkICYmIHJlcGx5Lndpbm5lci5oYXNoID09PSBjb21taXQuaGFzaDtcbiAgICBpZiAod2VXb24pIHtcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkud2lubmVyLmlkLCByZXBseS53aW5uZXIuY2xvY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGxvc3QgdGhlIHJhY2UuIE1hdGVyaWFsaXplIHRoZSB3aW5uZXIgZGlyZWN0bHkgXHUyMDE0IHRoZSBzZXJ2ZXIgaGFzXG4gICAgLy8gYWxyZWFkeSBwcmVzZXJ2ZWQgb3VyIGNvbnRlbnQgYXMgYSBjb25mbGljdCBjb3B5IChpZiBpdCB3YXMgZGlzdGluY3QpLlxuICAgIC8vIE9uZSBjYXZlYXQ6IGlmIHRoZSB3b3JraW5nIHRyZWUgbW92ZWQgb24gQUdBSU4gc2luY2Ugd2Ugc3RhZ2VkIHRoaXNcbiAgICAvLyBjb21taXQsIGRvIG5vdCBjbG9iYmVyIGl0IGVpdGhlciBcdTIwMTQgaGFuZCB0aGUgd2hvbGUgdGhpbmcgdG8gYSBjeWNsZS5cbiAgICBpZiAoY29tbWl0LmtpbmQgIT09ICdkZWxldGUnICYmIGNvbW1pdC5raW5kICE9PSAncmVuYW1lJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoY29tbWl0LnBhdGgpO1xuICAgICAgaWYgKGxvY2FsICE9PSB1bmRlZmluZWQgJiYgKGF3YWl0IHNoYTI1NkhleChsb2NhbCkpICE9PSBjb21taXQuaGFzaCkge1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBPdXIgcmVuYW1lIGxvc3Q6IHRoZSBmaWxlIHN0YXlzIHdoZXJlIHRoZSB3aW5uZXIga2VlcHMgaXQ7IHJlY29yZFxuICAgICAgLy8gdGhlIHdpbm5lciBoZWFkIGZvciB0aGUgZGVzdGluYXRpb24gKHRoZSBzb3VyY2UgcGF0aCBpcyB1bnRvdWNoZWQpLlxuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcbiAgICAgICAgcGF0aDogcmVwbHkud2lubmVyLnBhdGgsXG4gICAgICAgIHZlcnNpb25JZDogcmVwbHkud2lubmVyLmlkLFxuICAgICAgICBoYXNoOiByZXBseS53aW5uZXIuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVwbHkud2lubmVyLnNpemUsXG4gICAgICAgIGNsb2NrOiByZXBseS53aW5uZXIuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLndpbm5lckFzUHVsbChyZXBseS53aW5uZXIpXSk7XG4gIH1cblxuICAvKiogVHVybiBhbiBhcmJpdHJhdGVkIHdpbm5lciB2ZXJzaW9uIGludG8gYSBwdWxsIG9wIChjb250ZW50IG9wcyBvbmx5KS4gKi9cbiAgcHJpdmF0ZSB3aW5uZXJBc1B1bGwod2lubmVyOiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFzaDogc3RyaW5nO1xuICAgIHNpemU6IG51bWJlcjtcbiAgICBkZXZpY2VJZDogc3RyaW5nO1xuICAgIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gICAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xuICB9KTogUHVsbE9wIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbd2lubmVyLnBhdGhdO1xuICAgIGNvbnN0IGRlbGV0ZWQgPSB3aW5uZXIua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gZGVsZXRlZFxuICAgICAgPyAnZGVsZXRlJ1xuICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8gJ2FkZCdcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gJ3Jlc3RvcmUnXG4gICAgICAgICAgOiAnZWRpdCc7XG4gICAgcmV0dXJuIHtcbiAgICAgIGtpbmQsXG4gICAgICBwYXRoOiB3aW5uZXIucGF0aCxcbiAgICAgIGhhc2g6IHdpbm5lci5oYXNoLFxuICAgICAgc2l6ZTogd2lubmVyLnNpemUsXG4gICAgICB2ZXJzaW9uOiB3aW5uZXIuaWQsXG4gICAgICBjbG9jazogd2lubmVyLmNsb2NrLFxuICAgICAgZGVsZXRlZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCbG9iKGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYkFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2Jsb2JBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3B1dEJsb2InLCBoYXNoLCBjb250ZW50OiBieXRlc1RvQmFzZTY0KGJ5dGVzKSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZmV0Y2hCbG9iOiBGZXRjaEJsb2IgPSBhc3luYyAoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiA9PiB7XG4gICAgaWYgKGhhc2ggPT09ICcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcigncmVmdXNpbmcgdG8gZmV0Y2ggY29udGVudCBmb3IgYW4gZW1wdHkgaGFzaCcpO1xuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUuZ2V0KGhhc2gpO1xuICAgIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWRCbG9iKGhhc2gpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgICByZXR1cm4gYnl0ZXM7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkb3dubG9hZEJsb2IoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiAobS50eXBlID09PSAnYmxvYicgJiYgbS5oYXNoID09PSBoYXNoKSB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRCbG9iJywgaGFzaCB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGNvbnN0IGJ5dGVzID0gYmFzZTY0VG9CeXRlcyhyZXBseS5jb250ZW50KTtcbiAgICBpZiAoKGF3YWl0IHNoYTI1NkhleChieXRlcykpICE9PSBoYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgYmxvYiAke2hhc2h9IGZhaWxlZCB2ZXJpZmljYXRpb24gb24gZG93bmxvYWRgKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9XG5cbiAgLy8gLS0tIHBsdW1iaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHJlcXVlc3Q8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KFxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuLFxuICAgIHNlbmQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLmV4cGVjdGF0aW9uID0ge1xuICAgICAgICBtYXRjaGVzOiAobWVzc2FnZSkgPT4gbWF0Y2hlcyhtZXNzYWdlKSxcbiAgICAgICAgcmVzb2x2ZTogKG1lc3NhZ2UpID0+IHJlc29sdmUobWVzc2FnZSBhcyBUKSxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgfTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNlbmQoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZXhwZWN0YXRpb24gPSBudWxsO1xuICAgICAgICByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IE5ldHdvcmtFcnJvcihTdHJpbmcoZXJyb3IpKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRvRXJyb3IobWVzc2FnZTogU2VydmVyRXJyb3JNZXNzYWdlKTogRXJyb3Ige1xuICAgIHN3aXRjaCAobWVzc2FnZS5jb2RlKSB7XG4gICAgICBjYXNlICdVTkFVVEhPUklaRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFVuYXV0aG9yaXplZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICBjYXNlICdSRVZPS0VEJzpcbiAgICAgICAgcmV0dXJuIG5ldyBSZXZva2VkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBuZXcgUHJvdG9jb2xFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZW5xdWV1ZShvcGVyYXRpb246ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnF1ZXVlZE9wcyArPSAxO1xuICAgIGNvbnN0IHJ1biA9IHRoaXMudGFpbC50aGVuKG9wZXJhdGlvbiwgb3BlcmF0aW9uKTtcbiAgICBjb25zdCBzZXR0bGVkID0gcnVuLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICB9LFxuICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSxcbiAgICApO1xuICAgIC8vIFN3YWxsb3cgcmVqZWN0aW9ucyBvbiB0aGUgc2hhcmVkIHRhaWwgKGluZGl2aWR1YWwgY2FsbGVycyBzZWUgdGhlbSB2aWFcbiAgICAvLyBgc2V0dGxlZGApOyBvbmUgZmFpbGVkIG9wIG11c3Qgbm90IHBvaXNvbiB0aGUgcXVldWUuXG4gICAgdGhpcy50YWlsID0gc2V0dGxlZC50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBzZXR0bGVkO1xuICB9XG5cbiAgcHJpdmF0ZSBwZXJzaXN0SW5kZXgoKTogdm9pZCB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBzZXJpYWxpemVMb2NhbEluZGV4KHRoaXMuaW5kZXgpO1xuICAgIHZvaWQgdGhpcy5vcHRpb25zLnN0b3JhZ2VcbiAgICAgIC53cml0ZUZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCwgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNuYXBzaG90KSlcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2ZhaWxlZCB0byBwZXJzaXN0IGxvY2FsIGluZGV4JywgZXJyb3IpKTtcbiAgfVxufVxuXG4vLyAtLS0gbW9kdWxlLXByaXZhdGUgdHlwZSBhbGlhc2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFNlcnZlckVycm9yTWVzc2FnZSA9IEV4dHJhY3Q8U2VydmVyTWVzc2FnZSwgeyB0eXBlOiAnZXJyb3InIH0+O1xuIiwgIi8qKlxuICogYE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJgIFx1MjAxNCBjb3JlJ3MgYFN0b3JhZ2VBZGFwdGVyYCBvdmVyIHRoZSBPYnNpZGlhbiB2YXVsdFxuICogYERhdGFBZGFwdGVyYCAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnM6IHBsdWdpbiBpbXBsZW1lbnRhdGlvbiwgZGVza3RvcCBhbmRcbiAqIG1vYmlsZSBhbGlrZSkuXG4gKlxuICogUGF0aCBtYXBwaW5nOiBldmVyeSBwYXRoIGNyb3NzaW5nIHRoZSBjb3JlIHNlYW0gaXMgYSBQT1NJWC1ub3JtYWxpemVkIHZhdWx0XG4gKiBwYXRoIChgL25vdGVzL2EubWRgLCByb290IGAvYCk7IHRoZSBPYnNpZGlhbiBhZGFwdGVyIHdhbnRzIHRoZSBzYW1lIHBhdGhcbiAqICp3aXRob3V0KiB0aGUgbGVhZGluZyBzbGFzaCAoYG5vdGVzL2EubWRgKSwgd2l0aCBgL2AgKG9yIGAnJ2ApIGZvciB0aGUgcm9vdC5cbiAqXG4gKiBBbGwgd3JpdGVzIGdvIHRocm91Z2ggdGhlIGFkYXB0ZXIgKG5ldmVyIGB2YXVsdC5tb2RpZnlgIG9uIHRoZSBzaWRlKSwgc29cbiAqIE9ic2lkaWFuJ3Mgb3duIGZpbGUgd2F0Y2hpbmcgb2JzZXJ2ZXMgdGhlbSBsaWtlIGFueSBleHRlcm5hbCBlZGl0IGFuZCBvcGVuXG4gKiBlZGl0b3JzIHJlZnJlc2ggKEZSLTMpLiBXcml0ZXMgYXJlIGF0b21pYy1pc2g6IGNvbnRlbnQgbGFuZHMgaW4gYSB0ZW1wIGZpbGVcbiAqIHVuZGVyIGAvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAvYCAoY29yZSBpZ25vcmVzIHRoYXQgd2hvbGUgc3VidHJlZSkgYW5kIGlzXG4gKiByZW5hbWVkIG9udG8gdGhlIHRhcmdldDsgaWYgcmVuYW1pbmcgaXMgdW5hdmFpbGFibGUgKGV4b3RpYyBtb2JpbGVcbiAqIGFkYXB0ZXJzKSwgd2UgZmFsbCBiYWNrIHRvIGEgZGlyZWN0IHdyaXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRGF0YUFkYXB0ZXIgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEZpbGVTdGF0LCBTdG9yYWdlQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBub3JtYWxpemVWYXVsdFBhdGggfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogRGlyZWN0b3J5IChpbnNpZGUgdGhlIHZhdWx0KSBob2xkaW5nIHRlbXAgZmlsZXMgZHVyaW5nIGF0b21pYyB3cml0ZXMuICovXG5leHBvcnQgY29uc3QgVEVNUF9ESVJfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAnO1xuXG4vKiogU3RhdHMgT2JzaWRpYW4ncyBgRGF0YUFkYXB0ZXIuc3RhdGAgcmV0dXJucyBmb3IgYSBmaWxlLiAqL1xuaW50ZXJmYWNlIEFkYXB0ZXJTdGF0IHtcbiAgc2l6ZTogbnVtYmVyO1xuICBtdGltZTogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zIHtcbiAgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IERhdGFBZGFwdGVyO1xuICAvKipcbiAgICogTGF0Y2hlZCB3aGVuIGEgdGVtcCtyZW5hbWUgYXR0ZW1wdCBmYWlsczogZXZlcnkgbGF0ZXIgd3JpdGUgZ29lcyBzdHJhaWdodFxuICAgKiB0byBgd3JpdGVCaW5hcnlgIGluc3RlYWQgb2YgcGF5aW5nIHRoZSBmYWlsaW5nLXJlbmFtZSBwZW5hbHR5IGFnYWluLlxuICAgKi9cbiAgcHJpdmF0ZSB0ZW1wUmVuYW1lQnJva2VuID0gZmFsc2U7XG4gIHByaXZhdGUgdGVtcENvdW50ZXIgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zKSB7XG4gICAgdGhpcy5hZGFwdGVyID0gb3B0aW9ucy5hZGFwdGVyO1xuICB9XG5cbiAgLy8gLS0tIHBhdGggbWFwcGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFZhdWx0IHBhdGggXHUyMTkyIGFkYXB0ZXIgcGF0aCAoYC9hL2IubWRgIFx1MjE5MiBgYS9iLm1kYCwgYC9gIFx1MjE5MiBgL2ApLiAqL1xuICBwcml2YXRlIHRvQWRhcHRlclBhdGgodmF1bHRQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplZCA9PT0gJy8nID8gJy8nIDogbm9ybWFsaXplZC5zbGljZSgxKTtcbiAgfVxuXG4gIC8vIC0tLSBTdG9yYWdlQWRhcHRlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB0aGlzLmFkYXB0ZXIucmVhZEJpbmFyeSh0aGlzLnRvQWRhcHRlclBhdGgocGF0aCkpO1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShidWZmZXIpO1xuICB9XG5cbiAgYXN5bmMgd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVBhcmVudERpcnModGFyZ2V0KTtcbiAgICAvLyBDb3B5IGludG8gYSBzdGFuZGFsb25lIEFycmF5QnVmZmVyOiBgYnl0ZXMuYnVmZmVyYCBtYXkgYmUgYSBwb29sZWRcbiAgICAvLyBidWZmZXIgbGFyZ2VyIHRoYW4gdGhlIHZpZXcgKGNvcmUgc2xpY2VzIGFuZCByZXVzZXMgYnVmZmVycykuXG4gICAgY29uc3QgYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGRhdGEuYnl0ZUxlbmd0aCk7XG4gICAgbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAodGhpcy50ZW1wUmVuYW1lQnJva2VuKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0ZW1wID0gYXdhaXQgdGhpcy50ZW1wUGF0aCgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGVtcCwgYnVmZmVyKTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUodGVtcCwgdGFyZ2V0KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENsZWFuIHVwIHRoZSBvcnBoYW5lZCB0ZW1wIChiZXN0IGVmZm9ydCBcdTIwMTQgaXQgbGl2ZXMgaW4gdGhlIGlnbm9yZWRcbiAgICAgIC8vIHN0YXRlIGRpciwgc28gZXZlbiBhIGxlYWsgaXMgaW52aXNpYmxlIHRvIHN5bmMpLCB0aGVuIGZhbGwgYmFjayB0b1xuICAgICAgLy8gYSBkaXJlY3QsIG5vbi1hdG9taWMgd3JpdGUgcmF0aGVyIHRoYW4gZmFpbGluZyB0aGUgc3luYy5cbiAgICAgIGF3YWl0IHRoaXMuc2lsZW50UmVtb3ZlKHRlbXApO1xuICAgICAgdGhpcy50ZW1wUmVuYW1lQnJva2VuID0gdHJ1ZTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0YXJnZXQsIGJ1ZmZlcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBMb3N0IGEgcmFjZSB3aXRoIGEgY29uY3VycmVudCBkZWxldGUgXHUyMDE0IG9ubHkgc3VyZmFjZSBpZiBpdCBzdXJ2aXZlcy5cbiAgICAgIGlmIChhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpIHRocm93IG5ldyBFcnJvcihgZmFpbGVkIHRvIGRlbGV0ZSAke3RhcmdldH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW5hbWVGaWxlKGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZyb21QYXRoID0gdGhpcy50b0FkYXB0ZXJQYXRoKGZyb20pO1xuICAgIGNvbnN0IHRvUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aCh0byk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRvUGF0aCk7XG4gICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbmFtZShmcm9tUGF0aCwgdG9QYXRoKTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RGaWxlcygpOiBQcm9taXNlPHJlYWRvbmx5IEZpbGVTdGF0W10+IHtcbiAgICBjb25zdCBmaWxlczogRmlsZVN0YXRbXSA9IFtdO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZpbGVzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5zdGF0T3JOdWxsKGFkYXB0ZXJQYXRoKTtcbiAgICAgIGlmIChzdGF0ID09PSBudWxsKSByZXR1cm47IC8vIHZhbmlzaGVkIG1pZC13YWxrXG4gICAgICBmaWxlcy5wdXNoKHtcbiAgICAgICAgcGF0aDogYC8ke2FkYXB0ZXJQYXRofWAsXG4gICAgICAgIHNpemU6IHN0YXQuc2l6ZSxcbiAgICAgICAgbXRpbWU6IHN0YXQubXRpbWUsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBmaWxlcy5zb3J0KChhLCBiKSA9PiAoYS5wYXRoIDwgYi5wYXRoID8gLTEgOiBhLnBhdGggPiBiLnBhdGggPyAxIDogMCkpO1xuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIGFzeW5jIGxpc3REaXJzKCk6IFByb21pc2U8cmVhZG9ubHkgc3RyaW5nW10+IHtcbiAgICBjb25zdCBkaXJzOiBzdHJpbmdbXSA9IFsnLyddO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZvbGRlcnMoJy8nLCBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgIGRpcnMucHVzaChgLyR7YWRhcHRlclBhdGh9YCk7XG4gICAgfSk7XG4gICAgZGlycy5zb3J0KChhLCBiKSA9PiAoYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDApKTtcbiAgICByZXR1cm4gZGlycztcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZURpcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGNvbnN0IHNlZ21lbnRzID0gbm9ybWFsaXplZCA9PT0gJy8nID8gW10gOiBub3JtYWxpemVkLnNsaWNlKDEpLnNwbGl0KCcvJyk7XG4gICAgbGV0IGN1cnJlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50ID09PSAnJyA/IHNlZ21lbnQgOiBgJHtjdXJyZW50fS8ke3NlZ21lbnR9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHMoY3VycmVudCkpKSBhd2FpdCB0aGlzLmFkYXB0ZXIubWtkaXIoY3VycmVudCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIHRydWU7IC8vIHRoZSB2YXVsdCByb290IGFsd2F5cyBleGlzdHNcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGhpcy50b0FkYXB0ZXJQYXRoKG5vcm1hbGl6ZWQpKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGF0T3JOdWxsKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEFkYXB0ZXJTdGF0IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5hZGFwdGVyLnN0YXQoYWRhcHRlclBhdGgpO1xuICAgICAgaWYgKHN0YXQgPT09IG51bGwgfHwgc3RhdC50eXBlICE9PSAnZmlsZScpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgc2l6ZTogc3RhdC5zaXplLCBtdGltZTogc3RhdC5tdGltZSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgdW5pcXVlIHRlbXAgcGF0aCBpbnNpZGUgdGhlIChzeW5jLWlnbm9yZWQpIGNsaWVudCBzdGF0ZSBkaXIuICovXG4gIHByaXZhdGUgYXN5bmMgdGVtcFBhdGgoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihURU1QX0RJUl9WQVVMVF9QQVRIKTtcbiAgICB0aGlzLnRlbXBDb3VudGVyICs9IDE7XG4gICAgcmV0dXJuIGAke1RFTVBfRElSX1ZBVUxUX1BBVEguc2xpY2UoMSl9L3ctJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHt0aGlzLnRlbXBDb3VudGVyfS50bXBgO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzaWxlbnRSZW1vdmUoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKGFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGJlc3QgZWZmb3J0XG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWF0ZSBldmVyeSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgYW4gYWRhcHRlciBmaWxlIHBhdGguICovXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlUGFyZW50RGlycyhhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2xhc2ggPSBhZGFwdGVyUGF0aC5sYXN0SW5kZXhPZignLycpO1xuICAgIGlmIChzbGFzaCA8PSAwKSByZXR1cm47IC8vIHZhdWx0IHJvb3QgXHUyMDE0IGFsd2F5cyBleGlzdHNcbiAgICBjb25zdCBwYXJlbnQgPSBhZGFwdGVyUGF0aC5zbGljZSgwLCBzbGFzaCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXIoYC8ke3BhcmVudH1gKTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmaWxlIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGaWxlcyhcbiAgICBkaXJBZGFwdGVyUGF0aDogc3RyaW5nLFxuICAgIHZpc2l0OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxpc3Rpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGxpc3RpbmcgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubGlzdChkaXJBZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIHVucmVhZGFibGUvbWlzc2luZyBcdTIwMTQgdHJlYXQgYXMgZW1wdHlcbiAgICB9XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGxpc3RpbmcuZmlsZXMpIGF3YWl0IHZpc2l0KGZpbGUpO1xuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIGxpc3RpbmcuZm9sZGVycykgYXdhaXQgdGhpcy53YWxrRmlsZXMoZm9sZGVyLCB2aXNpdCk7XG4gIH1cblxuICAvKiogUmVjdXJzaXZlbHkgdmlzaXQgZXZlcnkgZm9sZGVyIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGb2xkZXJzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSB7XG4gICAgICBhd2FpdCB2aXNpdChmb2xkZXIpO1xuICAgICAgYXdhaXQgdGhpcy53YWxrRm9sZGVycyhmb2xkZXIsIHZpc2l0KTtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBPYnNpZGlhbldhdGNoQWRhcHRlcmAgKyBgUmVzY2FuU2NoZWR1bGVyYCBcdTIwMTQgY29yZSdzIGBXYXRjaEFkYXB0ZXJgIG92ZXJcbiAqIE9ic2lkaWFuIHZhdWx0IGV2ZW50cyAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnMpLCBwbHVzIHRoZSBwZXJpb2RpYyAvXG4gKiBmb2N1cy1kcml2ZW4gcmVjb25jaWxpYXRpb24gaG9va3MgdGhlIG1vYmlsZSAmIGV4dGVybmFsLWVkaXQgc3RvcmllcyBuZWVkXG4gKiAoXHUwMEE3OCBcIk1vYmlsZVwiLCBGUi01LCBGUi0xMikuXG4gKlxuICogVmF1bHQgZXZlbnRzIGNvdmVyIGV2ZXJ5dGhpbmcgT2JzaWRpYW4gaXRzZWxmIG9ic2VydmVzIFx1MjAxNCBpbi1hcHAgZWRpdHMsXG4gKiBkcmFnLWRyb3BzLCBhbmQgZXh0ZXJuYWwgZWRpdHMgbWFkZSB3aGlsZSBPYnNpZGlhbiBpcyAqb3BlbiouIEVkaXRzIG1hZGVcbiAqIHdoaWxlIE9ic2lkaWFuIHdhcyBjbG9zZWQgYXJlIHBpY2tlZCB1cCBieSB0aGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBhbmRcbiAqIGJ5IHRoZSBwZXJpb2RpYyByZXNjYW4gd2lyZWQgaGVyZTpcbiAqXG4gKiAgIHZhdWx0IGV2ZW50cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgV2F0Y2hBZGFwdGVyLnN0YXJ0KGNiKSBcdTI1MDBcdTI1QkEgU3luY0NsaWVudCBkZWJvdW5jZWQgY3ljbGVcbiAqICAgc2V0SW50ZXJ2YWwgKGRlZmF1bHQgMzBzKSBcdTI1MDBcdTI1QkEgUmVzY2FuU2NoZWR1bGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClcbiAqICAgYWN0aXZlLWxlYWYtY2hhbmdlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIucG9rZSgpIFx1MjUwMFx1MjUwMFx1MjVCQSAoc2hvcnQgZGVib3VuY2UsIHRoZW4gYSBjeWNsZSlcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50UmVmLCBUQWJzdHJhY3RGaWxlLCBWYXVsdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZUNoYW5nZUV2ZW50LCBXYXRjaEFkYXB0ZXIgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucyB7XG4gIHZhdWx0OiBWYXVsdDtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuV2F0Y2hBZGFwdGVyIGltcGxlbWVudHMgV2F0Y2hBZGFwdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB2YXVsdDogVmF1bHQ7XG4gIHByaXZhdGUgcmVmczogRXZlbnRSZWZbXSA9IFtdO1xuICBwcml2YXRlIGVtaXQ6ICgoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhbldhdGNoQWRhcHRlck9wdGlvbnMpIHtcbiAgICB0aGlzLnZhdWx0ID0gb3B0aW9ucy52YXVsdDtcbiAgfVxuXG4gIHN0YXJ0KGNiOiAoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMuZW1pdCA9IGNiO1xuICAgIC8vIEJvdGggZmlsZXMgYW5kIGZvbGRlcnMgYXJlIGZvcndhcmRlZDogZm9sZGVyIGV2ZW50cyAoY3JlYXRlL3JlbmFtZS9cbiAgICAvLyBkZWxldGUpIHRyaWdnZXIgdGhlIHJlY29uY2lsaWF0aW9uIHNjYW4gdGhhdCBkaXNjb3ZlcnMgZW1wdHktZm9sZGVyXG4gICAgLy8gcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiBUaGUgZW5naW5lIGZpbHRlcnMgaWdub3JlZCBwYXRocyBpdHNlbGYuXG4gICAgdGhpcy5yZWZzID0gW1xuICAgICAgdGhpcy52YXVsdC5vbignY3JlYXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2FkZCcsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdtb2RpZnknLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnbW9kaWZ5JywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ2RlbGV0ZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbigncmVuYW1lJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUsIG9sZFBhdGg6IHN0cmluZykgPT4ge1xuICAgICAgICAvLyBgb2xkUGF0aGAgXHUyMTkyIGBmaWxlLnBhdGhgOiB0aGUgZW50cnkgYXQgYHBhdGhgIG1vdmVkIHRvIGB0b1BhdGhgLlxuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAncmVuYW1lJywgcGF0aDogYC8ke29sZFBhdGh9YCwgdG9QYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgIF07XG4gIH1cblxuICBzdG9wKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgcmVmIG9mIHRoaXMucmVmcykgdGhpcy52YXVsdC5vZmZyZWYocmVmKTtcbiAgICB0aGlzLnJlZnMgPSBbXTtcbiAgICB0aGlzLmVtaXQgPSBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3J3YXJkKGV2ZW50OiBGaWxlQ2hhbmdlRXZlbnQpOiB2b2lkIHtcbiAgICB0aGlzLmVtaXQ/LihbZXZlbnRdKTtcbiAgfVxufVxuXG4vKiogVmF1bHQgZXZlbnQgcGF0aCAoYWRhcHRlci1ub3JtYWxpemVkLCBubyBsZWFkaW5nIHNsYXNoKSBcdTIxOTIgY29yZSB2YXVsdCBwYXRoLiAqL1xuZnVuY3Rpb24gdmF1bHRQYXRoT2YoZmlsZTogVEFic3RyYWN0RmlsZSk6IHN0cmluZyB7XG4gIHJldHVybiBmaWxlLnBhdGguc3RhcnRzV2l0aCgnLycpID8gZmlsZS5wYXRoIDogYC8ke2ZpbGUucGF0aH1gO1xufVxuXG4vLyAtLS0gUmVzY2FuU2NoZWR1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzY2FuU2NoZWR1bGVyT3B0aW9ucyB7XG4gIC8qKiBQZXJpb2QgYmV0d2VlbiBmdWxsIHJlc2NhbnMgaW4gbXM7IGAwYCBkaXNhYmxlcyB0aGUgcGVyaW9kaWMgdGltZXIuICovXG4gIGludGVydmFsTXM6IG51bWJlcjtcbiAgLyoqIERlYm91bmNlIHdpbmRvdyBmb3IgYHBva2UoKWAgKGFjdGl2ZS1sZWFmLWNoYW5nZSksIGRlZmF1bHQgMzAwMCBtcy4gKi9cbiAgcG9rZURlbGF5TXM/OiBudW1iZXI7XG4gIC8qKiBJbmplY3RhYmxlIHRpbWVyIHNlYW1zICh0ZXN0cyB1c2UgZmFrZSB0aW1lcnMgYWdhaW5zdCB0aGUgZ2xvYmFscykuICovXG4gIHNldEludGVydmFsSW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJJbnRlcnZhbEltcGw/OiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBzZXRUaW1lb3V0SW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJUaW1lb3V0SW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG59XG5cbi8qKlxuICogRHJpdmVzIHBlcmlvZGljICsgZm9jdXMtdHJpZ2dlcmVkIGZ1bGwgcmVjb25jaWxpYXRpb24gY3ljbGVzLiBOb3QgYVxuICogYFdhdGNoQWRhcHRlcmAgaXRzZWxmIFx1MjAxNCBpdHMgYHJ1bmAgY2FsbGJhY2sgaXMgd2lyZWQgdG9cbiAqIGBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClgIGJ5IHRoZSBwbHVnaW4gKGEgcmVzY2FuIGlzIGEgZnVsbCBjeWNsZSwgbm90IGFcbiAqIHNpbmdsZSBmaWxlIGV2ZW50KS5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlc2NhblNjaGVkdWxlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcG9rZURlbGF5TXM6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRJbnRlcnZhbEltcGw6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgcHJpdmF0ZSByZWFkb25seSBjbGVhckludGVydmFsSW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRUaW1lb3V0SW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFyVGltZW91dEltcGw6IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG5cbiAgcHJpdmF0ZSBydW46ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsSGFuZGxlOiB1bmtub3duID0gbnVsbDtcbiAgcHJpdmF0ZSBpbnRlcnZhbE1zOiBudW1iZXI7XG4gIHByaXZhdGUgcG9rZUhhbmRsZTogdW5rbm93biA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzY2FuU2NoZWR1bGVyT3B0aW9ucykge1xuICAgIHRoaXMuaW50ZXJ2YWxNcyA9IG9wdGlvbnMuaW50ZXJ2YWxNcztcbiAgICB0aGlzLnBva2VEZWxheU1zID0gb3B0aW9ucy5wb2tlRGVsYXlNcyA/PyAzMDAwO1xuICAgIHRoaXMuc2V0SW50ZXJ2YWxJbXBsID0gb3B0aW9ucy5zZXRJbnRlcnZhbEltcGwgPz8gKChmbiwgbXMpID0+IHNldEludGVydmFsKGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwgPSBvcHRpb25zLmNsZWFySW50ZXJ2YWxJbXBsID8/ICgoaGFuZGxlKSA9PiBjbGVhckludGVydmFsKGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgICB0aGlzLnNldFRpbWVvdXRJbXBsID0gb3B0aW9ucy5zZXRUaW1lb3V0SW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0VGltZW91dChmbiwgbXMpKTtcbiAgICB0aGlzLmNsZWFyVGltZW91dEltcGwgPSBvcHRpb25zLmNsZWFyVGltZW91dEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFyVGltZW91dChoYW5kbGUgYXMgbnVtYmVyKSk7XG4gIH1cblxuICAvKiogQmVnaW4gcGVyaW9kaWMgcmVzY2FuczsgYHJ1bmAgbXVzdCBiZSBzYWZlIHRvIGNhbGwgYXQgYW55IHRpbWUuICovXG4gIHN0YXJ0KHJ1bjogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMucnVuID0gcnVuO1xuICAgIHRoaXMuYXJtSW50ZXJ2YWwoKTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbEtlZXAoKTtcbiAgICBpZiAodGhpcy5wb2tlSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFyVGltZW91dEltcGwodGhpcy5wb2tlSGFuZGxlKTtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMucnVuID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBDaGFuZ2UgdGhlIHBlcmlvZGljIGludGVydmFsIGxpdmUgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlKS4gKi9cbiAgc2V0SW50ZXJ2YWxNcyhtczogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gbXM7XG4gICAgaWYgKHRoaXMucnVuICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIGZvY3VzL2FwcC1zd2l0Y2ggc2lnbmFsIChhY3RpdmUtbGVhZi1jaGFuZ2UpOiByZXNjYW4gc29vbiwgY29hbGVzY2VkLiAqL1xuICBwb2tlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJ1biA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHJldHVybjsgLy8gYWxyZWFkeSBzY2hlZHVsZWRcbiAgICB0aGlzLnBva2VIYW5kbGUgPSB0aGlzLnNldFRpbWVvdXRJbXBsKCgpID0+IHtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgICB0aGlzLnJ1bj8uKCk7XG4gICAgfSwgdGhpcy5wb2tlRGVsYXlNcyk7XG4gIH1cblxuICBnZXQgaW50ZXJ2YWxNc1ZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW50ZXJ2YWxNcztcbiAgfVxuXG4gIHByaXZhdGUgYXJtSW50ZXJ2YWwoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxNcyA8PSAwIHx8IHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IHRoaXMuc2V0SW50ZXJ2YWxJbXBsKCgpID0+IHRoaXMucnVuPy4oKSwgdGhpcy5pbnRlcnZhbE1zKTtcbiAgfVxuXG4gIHByaXZhdGUgY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsKHRoaXMuaW50ZXJ2YWxIYW5kbGUpO1xuICAgICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBgSHR0cEJsb2JTdG9yZWAgXHUyMDE0IGNvcmUncyBgQmxvYlN0b3JlYCBhZ2FpbnN0IHRoZSB3b3JrZXIncyBgL2Jsb2IvOmhhc2hgXG4gKiByb3V0ZXMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc1IEhUVFBTIHJvdXRlcyksIGF1dGhlbnRpY2F0ZWQgd2l0aCB0aGUgZGV2aWNlIHRva2VuXG4gKiBhcyBhIEJlYXJlciBoZWFkZXIuIEJ1aWx0IG9uIHRoZSBnbG9iYWwgYGZldGNoYCAoT2JzaWRpYW4gZGVza3RvcCBhbmRcbiAqIG1vYmlsZSksIGluamVjdGFibGUgZm9yIHRlc3RzLiBQbHVnaW4tbG9jYWwgdHdpbiBvZiB0aGUgbm9kZS1ydW50aW1lIG9uZTpcbiAqIG5vIGltcG9ydHMgZnJvbSBgQHZzYS9ub2RlLXJ1bnRpbWVgIChOb2RlLW9ubHkgcGFja2FnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBCbG9iU3RvcmUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogTm9uLTJ4eCBibG9iLXJvdXRlIHJlcGx5LiBgc3RhdHVzYCBpcyB0aGUgSFRUUCBzdGF0dXMgY29kZS4gKi9cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICByZWFkb25seSBzdGF0dXM6IG51bWJlcixcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdIdHRwQmxvYkVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEh0dHBCbG9iU3RvcmVPcHRpb25zIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAuICovXG4gIGJhc2VVcmw6IHN0cmluZztcbiAgLyoqIERldmljZSB0b2tlbiAoQmVhcmVyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIEluamVjdGFibGUgZmV0Y2ggKHRlc3RzKS4gRGVmYXVsdHMgdG8gdGhlIGdsb2JhbC4gKi9cbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoO1xufVxuXG5leHBvcnQgY2xhc3MgSHR0cEJsb2JTdG9yZSBpbXBsZW1lbnRzIEJsb2JTdG9yZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHRva2VuOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9GZXRjaDogdHlwZW9mIGZldGNoO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEh0dHBCbG9iU3RvcmVPcHRpb25zKSB7XG4gICAgdGhpcy5iYXNlID0gb3B0aW9ucy5iYXNlVXJsLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIHRoaXMudG9rZW4gPSBvcHRpb25zLnRva2VuO1xuICAgIHRoaXMuZG9GZXRjaCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGZldGNoO1xuICB9XG5cbiAgLyoqIEdFVCAvYmxvYi86aGFzaCBcdTIxOTIgYnl0ZXMsIG9yIGB1bmRlZmluZWRgIG9uIDQwNC4gKi9cbiAgYXN5bmMgZ2V0KGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5kb0ZldGNoKGAke3RoaXMuYmFzZX0vYmxvYi8ke2hhc2h9YCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gIH0sXG4gICAgfSk7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBIdHRwQmxvYkVycm9yKHJlc3BvbnNlLnN0YXR1cywgYXdhaXQgZXJyb3JNZXNzYWdlKHJlc3BvbnNlLCAnZmV0Y2ggYmxvYicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IHJlc3BvbnNlLmFycmF5QnVmZmVyKCkpO1xuICB9XG5cbiAgLyoqIFBVVCAvYmxvYi86aGFzaCBcdTIwMTQgaWRlbXBvdGVudCBwZXIgdGhlIENBUyBjb250cmFjdC4gKi9cbiAgYXN5bmMgcHV0KGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnRva2VufWAsXG4gICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBieXRlcyBhcyBCb2R5SW5pdCxcbiAgICB9KTtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ3N0b3JlIGJsb2InKSk7XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVycm9yTWVzc2FnZShyZXNwb25zZTogUmVzcG9uc2UsIHdoYXQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS5zbGljZSgwLCAzMDApO1xuICByZXR1cm4gZGV0YWlsID09PSAnJ1xuICAgID8gYGZhaWxlZCB0byAke3doYXR9OiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWBcbiAgICA6IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZGV0YWlsfWA7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGx1Z2luJ3MgcGVyc2lzdGVkIHN0YXRlIChgZGF0YS5qc29uYCwgdmlhIGBQbHVnaW4ubG9hZERhdGEvc2F2ZURhdGFgKS5cbiAqXG4gKiBLZXB0IGRlbGliZXJhdGVseSBzbWFsbDogbGluayBpZGVudGl0eSAodXJsL3Rva2VuL2RldmljZUlkL2RldmljZU5hbWUpIHBsdXNcbiAqIHRoZSB0d28gY2xpZW50LXNpZGUgdG9nZ2xlcy4gVGhlIHRva2VuIGlzIHRoZSBkZXZpY2UncyBsb25nLWxpdmVkXG4gKiBjcmVkZW50aWFsIChBUkNISVRFQ1RVUkUgXHUwMEE3MykgXHUyMDE0IE9ic2lkaWFuIHN0b3JlcyBkYXRhLmpzb24gaW5zaWRlIHRoZSB2YXVsdCdzXG4gKiBgLm9ic2lkaWFuL3BsdWdpbnMvYCBkaXIsIHdoaWNoIHN5bmMgZXhjbHVkZXMsIHNvIGl0IG5ldmVyIGxlYXZlcyB0aGVcbiAqIG1hY2hpbmUgdGhyb3VnaCBzeW5jIGl0c2VsZi5cbiAqL1xuXG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gJ29ic2lkaWFuJztcblxuLyoqIENsaWVudC1zaWRlIHN5bmMgYmVoYXZpb3Igc2V0dGluZ3MgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlcykuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpblN5bmNTZXR0aW5ncyB7XG4gIC8qKlxuICAgKiBQZXJpb2RpYyBmdWxsLXJlc2NhbiBpbnRlcnZhbCBpbiBzZWNvbmRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBtb2JpbGUgL1xuICAgKiBleHRlcm5hbCBlZGl0cykuIGAwYCBkaXNhYmxlcyB0aGUgdGltZXIgXHUyMDE0IHZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW5cbiAgICogcmVjb25jaWxpYXRpb24gc3RpbGwgcnVuLlxuICAgKi9cbiAgcmVzY2FuSW50ZXJ2YWxTZWM6IG51bWJlcjtcbiAgLyoqXG4gICAqIE9wdCBpbiB0byBzeW5jaW5nIGAub2JzaWRpYW4vYCAoRlItMTEpLiBUaGlzIGlzIHRoZSBjbGllbnQtc2lkZSBpbml0aWFsXG4gICAqIGlnbm9yZSBzZXR0aW5nOyB0aGUgd29ya2VyJ3MgcGVyLXZhdWx0IGBWYXVsdFNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAgICogKGRlbGl2ZXJlZCBpbiBgaGVsbG9BY2tgKSBzdXBlcnNlZGVzIGl0IG9uY2UgY29ubmVjdGVkLlxuICAgKi9cbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xufVxuXG4vKiogU2hhcGUgb2YgdGhlIHBsdWdpbidzIGBkYXRhLmpzb25gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAgKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBMb25nLWxpdmVkIGRldmljZSB0b2tlbiAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogRGV2aWNlIGlkIGFzc2lnbmVkIGJ5IHRoZSB3b3JrZXIgYXQgcGFpciB0aW1lLiAqL1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICAvKiogSHVtYW4tcmVhZGFibGUgZGV2aWNlIG5hbWUgc2hvd24gaW4gdGhlIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiAqL1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBQbHVnaW5TeW5jU2V0dGluZ3M7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMgPSAzMDtcblxuLyoqIENob2ljZXMgb2ZmZXJlZCBieSB0aGUgc2V0dGluZ3MgZHJvcGRvd246IHNlY29uZHMgXHUyMTkyIGxhYmVsLiAqL1xuZXhwb3J0IGNvbnN0IFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTOiBSZWFkb25seUFycmF5PHsgdmFsdWU6IG51bWJlcjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgeyB2YWx1ZTogMTAsIGxhYmVsOiAnRXZlcnkgMTAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogMzAsIGxhYmVsOiAnRXZlcnkgMzAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogNjAsIGxhYmVsOiAnRXZlcnkgbWludXRlJyB9LFxuICB7IHZhbHVlOiAzMDAsIGxhYmVsOiAnRXZlcnkgNSBtaW51dGVzJyB9LFxuICB7IHZhbHVlOiAwLCBsYWJlbDogJ09mZiAodmF1bHQgZXZlbnRzIG9ubHkpJyB9LFxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRQbHVnaW5EYXRhKCk6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICByZXR1cm4ge1xuICAgIHVybDogJycsXG4gICAgdG9rZW46ICcnLFxuICAgIGRldmljZUlkOiAnJyxcbiAgICBkZXZpY2VOYW1lOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogZmFsc2UsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIENvZXJjZSB3aGF0ZXZlciBgbG9hZERhdGEoKWAgcmV0dXJuZWQgaW50byBhIHdlbGwtZm9ybWVkIG9iamVjdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQbHVnaW5EYXRhKHJhdzogdW5rbm93bik6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgaWYgKHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IHNvdXJjZSA9IHJhdyBhcyBQYXJ0aWFsPFZhdWx0U3luY1BsdWdpbkRhdGE+ICYgeyBzZXR0aW5ncz86IFBhcnRpYWw8UGx1Z2luU3luY1NldHRpbmdzPiB9O1xuICByZXR1cm4ge1xuICAgIHVybDogdHlwZW9mIHNvdXJjZS51cmwgPT09ICdzdHJpbmcnID8gc291cmNlLnVybCA6ICcnLFxuICAgIHRva2VuOiB0eXBlb2Ygc291cmNlLnRva2VuID09PSAnc3RyaW5nJyA/IHNvdXJjZS50b2tlbiA6ICcnLFxuICAgIGRldmljZUlkOiB0eXBlb2Ygc291cmNlLmRldmljZUlkID09PSAnc3RyaW5nJyA/IHNvdXJjZS5kZXZpY2VJZCA6ICcnLFxuICAgIGRldmljZU5hbWU6IHR5cGVvZiBzb3VyY2UuZGV2aWNlTmFtZSA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlTmFtZSA6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzpcbiAgICAgICAgdHlwZW9mIHNvdXJjZS5zZXR0aW5ncz8ucmVzY2FuSW50ZXJ2YWxTZWMgPT09ICdudW1iZXInICYmIHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA+PSAwXG4gICAgICAgICAgPyBNYXRoLmZsb29yKHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYylcbiAgICAgICAgICA6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogc291cmNlLnNldHRpbmdzPy5vYnNpZGlhblN5bmMgPT09IHRydWUsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIEEgdmF1bHQgaXMgbGlua2VkIGlmZiBwYWlyIGlkZW50aXR5IGlzIGNvbXBsZXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTGlua2VkKGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEpOiBib29sZWFuIHtcbiAgcmV0dXJuIGRhdGEudXJsICE9PSAnJyAmJiBkYXRhLnRva2VuICE9PSAnJyAmJiBkYXRhLmRldmljZUlkICE9PSAnJztcbn1cblxuLyoqIERldmljZSB0eXBlIGZvciB0aGUgd29ya2VyIHJlZ2lzdHJ5LCBmcm9tIHRoZSBwbGF0Zm9ybSAoRlItMjMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdERldmljZVR5cGUoKTogJ2Rlc2t0b3AnIHwgJ21vYmlsZScge1xuICByZXR1cm4gUGxhdGZvcm0uaXNNb2JpbGVBcHAgPyAnbW9iaWxlJyA6ICdkZXNrdG9wJztcbn1cblxuLyoqIERlZmF1bHQgZGV2aWNlIG5hbWUgd2hlbiB0aGUgdXNlciBoYXMgbm90IHR5cGVkIG9uZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0RGV2aWNlTmFtZSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBpZiAoUGxhdGZvcm0uaXNJb3NBcHApIHJldHVybiAnaVBob25lL2lQYWQnO1xuICAgIGlmIChQbGF0Zm9ybS5pc0FuZHJvaWRBcHApIHJldHVybiAnQW5kcm9pZCc7XG4gICAgcmV0dXJuICdPYnNpZGlhbiBtb2JpbGUnO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCc7XG59XG4iLCAiLyoqXG4gKiBNaW5pbWFsIHR5cGVkIGNsaWVudCBmb3IgdGhlIHdvcmtlcidzIEhUVFAgc3VyZmFjZSBhcyB0aGUgcGx1Z2luIHVzZXMgaXQ6XG4gKiBgR0VUIC9oZWFsdGhgIChjbGFpbS1zdGF0ZSBwcm9iZSBiZWZvcmUgcGFpcmluZykgYW5kIGBQT1NUIC9wYWlyYCAocmVkZWVtIGFcbiAqIHBhaXJpbmcgY29kZSwgQVJDSElURUNUVVJFIFx1MDBBNzMpLiBCdWlsdCBvbiBhbiBpbmplY3RhYmxlIGBmZXRjaGA7IGZhaWx1cmVzXG4gKiBtYXAgdG8gdHlwZWQgZXJyb3JzIHdpdGggYWN0aW9uYWJsZSBtZXNzYWdlcyBzbyB0aGUgc2V0dGluZ3MgVUkgYW5kIHRoZVxuICogZGVlcC1saW5rIGhhbmRsZXIgbmV2ZXIgc2VlIGEgcmF3IGBUeXBlRXJyb3I6IEZhaWxlZCB0byBmZXRjaGAuXG4gKi9cblxuLyoqIEEgd29ya2VyIGNhbGwgZmFpbGVkICh1bnJlYWNoYWJsZSBvciB1bmV4cGVjdGVkIEhUVFApLiAqL1xuZXhwb3J0IGNsYXNzIFdvcmtlckFwaUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgc3RhdHVzPzogbnVtYmVyLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnV29ya2VyQXBpRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgcGFpcmluZyBjb2RlIHdhcyByZWplY3RlZCAoaW52YWxpZCAvIGV4cGlyZWQgLyBhbHJlYWR5IHVzZWQpLiAqL1xuZXhwb3J0IGNsYXNzIFBhaXJSZWplY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnUGFpclJlamVjdGVkRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgd29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBzZW1hbnRpY3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZFdvcmtlckVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnVW5jbGFpbWVkV29ya2VyRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhbHRoSW5mbyB7XG4gIHJlYWNoYWJsZTogYm9vbGVhbjtcbiAgY2xhaW1lZDogYm9vbGVhbjtcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIHJlYXNvbiB3aGVuIHRoZSB3b3JrZXIgY291bGQgbm90IGJlIHJlYWNoZWQuICovXG4gIHJlYXNvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYWlyQ3JlZGVudGlhbHMge1xuICB0b2tlbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSB1c2VyIGlucHV0IGludG8gYSB3b3JrZXIgb3JpZ2luOiB0cmltcywgdG9sZXJhdGVzIGEgbWlzc2luZ1xuICogc2NoZW1lIChhc3N1bWVzIGh0dHBzKSwgYSB0cmFpbGluZyBzbGFzaCwgYW5kIHN0cmF5IHBhdGggY29tcG9uZW50cztcbiAqIHJldHVybnMgYGh0dHBzOi8vaG9zdGAgc3R5bGUgb3JpZ2luLiBUaHJvd3MgYFdvcmtlckFwaUVycm9yYCBvbiBnYXJiYWdlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyVXJsKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2FuZGlkYXRlID0gaW5wdXQudHJpbSgpO1xuICBpZiAoY2FuZGlkYXRlID09PSAnJykgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCd3b3JrZXIgVVJMIGlzIGVtcHR5Jyk7XG4gIGlmICghL15bYS16QS1aXVthLXpBLVowLTkrLi1dKjpcXC9cXC8vLnRlc3QoY2FuZGlkYXRlKSkgY2FuZGlkYXRlID0gYGh0dHBzOi8vJHtjYW5kaWRhdGV9YDtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5ldyBVUkwoY2FuZGlkYXRlKS5vcmlnaW47XG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgaW52YWxpZCB3b3JrZXIgVVJMOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gKTtcbiAgfVxuICBpZiAoIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwOi8vJykgJiYgIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwczovLycpKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKGB3b3JrZXIgVVJMIG11c3QgYmUgaHR0cChzKSwgZ290ICR7b3JpZ2lufWApO1xuICB9XG4gIHJldHVybiBvcmlnaW47XG59XG5cbi8qKiBHRVQgL2hlYWx0aCBcdTIwMTQgbmV2ZXIgdGhyb3dzIGZvciByZWFjaGFiaWxpdHk7IHJlcG9ydHMgY2xhaW0gc3RhdGUgaW5zdGVhZC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEhlYWx0aChcbiAgb3JpZ2luOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoLFxuKTogUHJvbWlzZTxIZWFsdGhJbmZvPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaEltcGwoYCR7b3JpZ2lufS9oZWFsdGhgKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgcmVhY2hhYmxlOiBmYWxzZSxcbiAgICAgIGNsYWltZWQ6IGZhbHNlLFxuICAgICAgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgfTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgcmV0dXJuIHsgcmVhY2hhYmxlOiBmYWxzZSwgY2xhaW1lZDogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YCB9O1xuICB9XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpKSBhcyB7IGNsYWltZWQ/OiBib29sZWFuIH07XG4gIHJldHVybiB7IHJlYWNoYWJsZTogdHJ1ZSwgY2xhaW1lZDogYm9keS5jbGFpbWVkID09PSB0cnVlIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpclJlcXVlc3RQYXJhbXMge1xuICBvcmlnaW46IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIGRldmljZVR5cGU6ICdkZXNrdG9wJyB8ICdtb2JpbGUnO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBQT1NUIC9wYWlyIFx1MjAxNCByZWRlZW0gYSBvbmUtdGltZSBwYWlyaW5nIGNvZGUgZm9yIGxvbmctbGl2ZWQgZGV2aWNlXG4gKiBjcmVkZW50aWFscy4gVGhyb3dzIGBQYWlyUmVqZWN0ZWRFcnJvcmAgKGJhZCBjb2RlKSwgYFVuY2xhaW1lZFdvcmtlckVycm9yYFxuICogKDQyMSksIG9yIGBXb3JrZXJBcGlFcnJvcmAgKHVucmVhY2hhYmxlIC8gdW5leHBlY3RlZCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1ZXN0UGFpcihwYXJhbXM6IFBhaXJSZXF1ZXN0UGFyYW1zKTogUHJvbWlzZTxQYWlyQ3JlZGVudGlhbHM+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vcGFpcmAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgICAgZGV2aWNlVHlwZTogcGFyYW1zLmRldmljZVR5cGUsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgY291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXIgYXQgJHtwYXJhbXMub3JpZ2lufTogJHtcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9YCxcbiAgICApO1xuICB9XG4gIC8vIFJlYWQgdGhlIGJvZHkgb25jZSAoYSBSZXNwb25zZSBib2R5IGlzIHNpbmdsZS11c2UpIGFuZCBwYXJzZSBmcm9tIHRleHQuXG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS50cmltKCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQyMSkge1xuICAgIHRocm93IG5ldyBVbmNsYWltZWRXb3JrZXJFcnJvcigndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0Jyk7XG4gIH1cbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxIHx8IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgdGhyb3cgbmV3IFBhaXJSZWplY3RlZEVycm9yKFxuICAgICAgJ3BhaXJpbmcgY29kZSByZWplY3RlZCBcdTIwMTQgY29kZXMgYXJlIG9uZS10aW1lLCBleHBpcmUgYWZ0ZXIgMTAgbWludXRlcywgYW5kIGNvbWUgJyArXG4gICAgICAgICdmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiBHZW5lcmF0ZSBhIGZyZXNoIG9uZSBhbmQgcmV0cnkuJyxcbiAgICApO1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgcGFpcmluZyBmYWlsZWQ6IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9ICR7ZGV0YWlsLnNsaWNlKDAsIDIwMCl9YC50cmltKCksXG4gICAgICByZXNwb25zZS5zdGF0dXMsXG4gICAgKTtcbiAgfVxuICBsZXQgYm9keTogeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG5vdCBKU09OJywgcmVzcG9uc2Uuc3RhdHVzKTtcbiAgfVxuICBpZiAodHlwZW9mIGJvZHkudG9rZW4gIT09ICdzdHJpbmcnIHx8IHR5cGVvZiBib2R5LmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcigncGFpcmluZyByZXBseSB3YXMgbWlzc2luZyB0b2tlbi9kZXZpY2VJZCcsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgcmV0dXJuIHsgdG9rZW46IGJvZHkudG9rZW4sIGRldmljZUlkOiBib2R5LmRldmljZUlkIH07XG59XG4iLCAiLyoqXG4gKiBUaGUgcGFpciBmbG93IHNoYXJlZCBieSB0aGUgc2V0dGluZ3MgZm9ybSBhbmQgdGhlIGBvYnNpZGlhbjovL2AgZGVlcCBsaW5rXG4gKiAoQVJDSElURUNUVVJFIFx1MDBBNzMpOiBwcm9iZSBgR0VUIC9oZWFsdGhgIGZpcnN0IFx1MjAxNCBhbiAqdW5jbGFpbWVkKiB3b3JrZXIgZ2V0c1xuICogZnJpZW5kbHkgb25ib2FyZGluZyBndWlkYW5jZSBpbnN0ZWFkIG9mIGEgY3J5cHRpYyA0MjEgXHUyMDE0IHRoZW4gYFBPU1QgL3BhaXJgXG4gKiBhbmQgaGFuZCB0aGUgY3JlZGVudGlhbHMgYmFjayB0byBiZSBwZXJzaXN0ZWQuXG4gKi9cblxuaW1wb3J0IHtcbiAgZmV0Y2hIZWFsdGgsXG4gIG5vcm1hbGl6ZVdvcmtlclVybCxcbiAgcmVxdWVzdFBhaXIsXG4gIFBhaXJSZWplY3RlZEVycm9yLFxuICBVbmNsYWltZWRXb3JrZXJFcnJvcixcbiAgV29ya2VyQXBpRXJyb3IsXG59IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuZXhwb3J0IHR5cGUgUGFpck91dGNvbWUgPVxuICB8IHsgc3RhdHVzOiAncGFpcmVkJzsgdXJsOiBzdHJpbmc7IHRva2VuOiBzdHJpbmc7IGRldmljZUlkOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5jbGFpbWVkJzsgdXJsOiBzdHJpbmc7IGd1aWRhbmNlOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZWFjaGFibGUnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAncmVqZWN0ZWQnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAnaW52YWxpZC11cmwnOyBpbnB1dDogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckZsb3dQYXJhbXMge1xuICAvKiogV29ya2VyIFVSTCBhcyB0eXBlZCAvIGRlZXAtbGlua2VkIChzY2hlbWVsZXNzIGlzIHRvbGVyYXRlZCkuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogT25lLXRpbWUgcGFpcmluZyBjb2RlIGZyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQuICovXG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKiBPbmJvYXJkaW5nIHRleHQgc2hvd24gd2hlbiB0aGUgd29ya2VyIGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmNsYWltZWRHdWlkYW5jZSh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgYFRoZSB3b3JrZXIgYXQgJHt1cmx9IGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZCB5ZXQuIEZpbmlzaCBzZXR1cCBpbiBhIGJyb3dzZXI6YCxcbiAgICAnJyxcbiAgICBgMS4gT3BlbiAke3VybH1gLFxuICAgICcyLiBTZXQgdGhlIGFkbWluIHBhc3NwaHJhc2UgYW5kIG5hbWUgdGhlIHZhdWx0ICh0aGUgY2xhaW0gcGFnZSkuJyxcbiAgICAnMy4gT24gdGhlIGRhc2hib2FyZCwgY3JlYXRlIGEgcGFpcmluZyBjb2RlIChEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UpLicsXG4gICAgJzQuIEVudGVyIHRoYXQgY29kZSBoZXJlIChvciBjbGljayB0aGUgb2JzaWRpYW46Ly8gbGluayB0aGUgZGFzaGJvYXJkIHNob3dzKSBhbmQgcGFpci4nLFxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgcGFpciBmbG93LiBOZXZlciB0aHJvd3MgXHUyMDE0IGV2ZXJ5IGZhaWx1cmUgbW9kZSBpcyBhIHR5cGVkIG91dGNvbWUgdGhlXG4gKiBVSSBjYW4gcmVuZGVyIChhbmQgdGhlIGRlZXAtbGluayBoYW5kbGVyIGNhbiB0dXJuIGludG8gYSBOb3RpY2UpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGFpcldpdGhXb3JrZXIocGFyYW1zOiBQYWlyRmxvd1BhcmFtcyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5vcm1hbGl6ZVdvcmtlclVybChwYXJhbXMudXJsKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnaW52YWxpZC11cmwnLCBpbnB1dDogcGFyYW1zLnVybCB9O1xuICB9XG5cbiAgY29uc3QgaGVhbHRoID0gYXdhaXQgZmV0Y2hIZWFsdGgob3JpZ2luLCBwYXJhbXMuZmV0Y2hJbXBsKTtcbiAgaWYgKCFoZWFsdGgucmVhY2hhYmxlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3VucmVhY2hhYmxlJyxcbiAgICAgIHVybDogb3JpZ2luLFxuICAgICAgcmVhc29uOlxuICAgICAgICBgJHtoZWFsdGgucmVhc29uID8/ICd1bmtub3duIGVycm9yJ30gXHUyMDE0IGNoZWNrIHRoZSBVUkwsIHlvdXIgbmV0d29yaywgYW5kIHRoYXQgdGhlIGAgK1xuICAgICAgICAnd29ya2VyIGlzIGRlcGxveWVkLicsXG4gICAgfTtcbiAgfVxuICBpZiAoIWhlYWx0aC5jbGFpbWVkKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNyZWRlbnRpYWxzID0gYXdhaXQgcmVxdWVzdFBhaXIoe1xuICAgICAgb3JpZ2luLFxuICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgZmV0Y2hJbXBsOiBwYXJhbXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3BhaXJlZCcsIHVybDogb3JpZ2luLCAuLi5jcmVkZW50aWFscyB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFVuY2xhaW1lZFdvcmtlckVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNsYWltZWQnLCB1cmw6IG9yaWdpbiwgZ3VpZGFuY2U6IHVuY2xhaW1lZEd1aWRhbmNlKG9yaWdpbikgfTtcbiAgICB9XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUGFpclJlamVjdGVkRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbjogZXJyb3IubWVzc2FnZSB9O1xuICAgIH1cbiAgICBjb25zdCByZWFzb24gPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cmw6IG9yaWdpbiwgcmVhc29uIH07XG4gIH1cbn1cblxuLyoqIFJlbmRlciBhbnkgb3V0Y29tZSBhcyB1c2VyLWZhY2luZyB0ZXh0IChOb3RpY2VzLCBkZWVwLWxpbmsgZmVlZGJhY2spLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAob3V0Y29tZS5zdGF0dXMpIHtcbiAgICBjYXNlICdwYWlyZWQnOlxuICAgICAgcmV0dXJuIGBQYWlyZWQgd2l0aCAke291dGNvbWUudXJsfSBcdTIwMTQgc3luY2luZyBub3cuYDtcbiAgICBjYXNlICd1bmNsYWltZWQnOlxuICAgICAgcmV0dXJuIG91dGNvbWUuZ3VpZGFuY2U7XG4gICAgY2FzZSAndW5yZWFjaGFibGUnOlxuICAgICAgcmV0dXJuIGBDb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlcjogJHtvdXRjb21lLnJlYXNvbn1gO1xuICAgIGNhc2UgJ3JlamVjdGVkJzpcbiAgICAgIHJldHVybiBgUGFpcmluZyBmYWlsZWQ6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdpbnZhbGlkLXVybCc6XG4gICAgICByZXR1cm4gYFRoYXQgZG9lcyBub3QgbG9vayBsaWtlIGEgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShvdXRjb21lLmlucHV0KX1gO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMvcGFpcj91cmw9PHdvcmtlcj4mY29kZT08cGFpcmluZz5gIGRlZXAtbGlua1xuICogaGFuZGxpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogdGhlIGRhc2hib2FyZCByZW5kZXJzIHRoaXMgbGluayAoYW5kIHRoZSBRUlxuICogZXF1aXZhbGVudCkgc28gYSBuZXcgZGV2aWNlIHBhaXJzIHdpdGggemVybyB0eXBpbmcuXG4gKlxuICogVGhlIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgdGhlIGFjdGlvbiBgdmF1bHRzeW5jZm9yYWdlbnRzYC4gT2JzaWRpYW5cbiAqIGJ1aWxkcyBkaWZmZXIgc3VidGx5IGluIGhvdyB0aGUgYC9wYWlyYCBwYXRoIHNlZ21lbnQgb2YgYSBwcm90b2NvbCBVUkwgaXNcbiAqIG1hdGNoZWQsIHNvIHRoZSBzYW1lIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgYHZhdWx0c3luY2ZvcmFnZW50cy9wYWlyYFxuICogdG9vIFx1MjAxNCB3aGljaGV2ZXIgc3BlbGxpbmcgYSBnaXZlbiBidWlsZCByZXNvbHZlcywgdGhlIGxpbmsgd29ya3MuIFdoZW5cbiAqIGB1cmxgL2Bjb2RlYCBhcmUgYWJzZW50IHRoZSBpbnZvY2F0aW9uIGlzIGlnbm9yZWQgKGEgc3RyYXkgcHJvdG9jb2wgaGl0XG4gKiBtdXN0IG5vdCBzcGFtIGEgTm90aWNlKTsgYSAqbWFsZm9ybWVkKiBwYWlyIGxpbmsgKG9uZSBvZiB0aGUgdHdvIHByZXNlbnQpXG4gKiBnZXRzIGFuIGFjdGlvbmFibGUgZXJyb3IuXG4gKi9cblxuaW1wb3J0IHsgTm90aWNlIH0gZnJvbSAnb2JzaWRpYW4nO1xuXG4vKiogUHJvdG9jb2wgYWN0aW9uICh0aGUgYG9ic2lkaWFuOi8vYCBcImhvc3RcIiBwYXJ0KS4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT0NPTF9BQ1RJT04gPSAndmF1bHRzeW5jZm9yYWdlbnRzJztcblxuLyoqIEhhbmRsZXIgc2hhcGUgKE9ic2lkaWFuIHBhc3NlcyBpdHMgZGVjb2RlZCBxdWVyeSBwYXJhbXMpLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xIYW5kbGVyID0gKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQ7XG5cbi8qKiBIb3cgaGFuZGxlcnMgZ2V0IHJlZ2lzdGVyZWQgXHUyMDE0IGBQbHVnaW4ucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcmAuICovXG5leHBvcnQgdHlwZSBQcm90b2NvbFJlZ2lzdHJhciA9IChhY3Rpb246IHN0cmluZywgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyKSA9PiB2b2lkO1xuXG4vKiogUGFyc2VkIHBhaXIgZGVlcCBsaW5rLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWlyRGVlcExpbmsge1xuICB1cmw6IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBEZWVwTGlua1BhcnNlUmVzdWx0ID1cbiAgfCB7IG9rOiB0cnVlOyBsaW5rOiBQYWlyRGVlcExpbmsgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbi8qKlxuICogRXh0cmFjdCBge3VybCwgY29kZX1gIGZyb20gT2JzaWRpYW4ncyBkZWNvZGVkIHF1ZXJ5IHBhcmFtcy4gVmFsdWVzIGFycml2ZVxuICogYXMgc3RyaW5ncyAodXN1YWxseSBhbHJlYWR5IGRlY29kZWQ7IGEgZG91YmxlLWVuY29kZWQgYCV4eGAgcmVtbmFudCBpc1xuICogZGVjb2RlZCBvbmNlIG1vcmUsIGJlc3QgZWZmb3J0KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGFpckRlZXBMaW5rKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBEZWVwTGlua1BhcnNlUmVzdWx0IHtcbiAgY29uc3QgdXJsID0gcGFyYW1UZXh0KHBhcmFtcywgJ3VybCcpO1xuICBjb25zdCBjb2RlID0gcGFyYW1UZXh0KHBhcmFtcywgJ2NvZGUnKTtcbiAgaWYgKHVybCA9PT0gJycgJiYgY29kZSA9PT0gJycpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJyB9O1xuICB9XG4gIGlmICh1cmwgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHdvcmtlciBVUkwgKD91cmw9XHUyMDI2KScgfTtcbiAgaWYgKGNvZGUgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHBhaXJpbmcgY29kZSAoP2NvZGU9XHUyMDI2KScgfTtcbiAgcmV0dXJuIHsgb2s6IHRydWUsIGxpbms6IHsgdXJsLCBjb2RlIH0gfTtcbn1cblxuZnVuY3Rpb24gcGFyYW1UZXh0KHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdmFsdWUgPSBwYXJhbXNba2V5XTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuICcnO1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICAvLyBPYnNpZGlhbiBoYW5kcyBvdmVyIGRlY29kZWQgdmFsdWVzOyB0b2xlcmF0ZSBvbmUgc3Vydml2aW5nIHJvdW5kIG9mXG4gIC8vIHBlcmNlbnQtZW5jb2RpbmcgZnJvbSBvdmVyLWVhZ2VyIGxpbmsgZ2VuZXJhdG9ycy5cbiAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoJyUnKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHRyaW1tZWQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJlZ2lzdGVyIHRoZSBwYWlyIGRlZXAtbGluayBoYW5kbGVyIChjYWxsIGZyb20gYG9ubG9hZGAgd2l0aCB0aGUgcGx1Z2luJ3NcbiAqIG93biByZWdpc3RyYXIpLiBgb25QYWlyYCBydW5zIHRoZSBzaGFyZWQgcGFpciBmbG93IChzZXR0aW5ncyArIE5vdGljZXNcbiAqIGxpdmUgaW4gdGhlIHBsdWdpbik7IGl0cyBlcnJvcnMgYXJlIGxvZ2dlZCwgbmV2ZXIgZmF0YWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIoXG4gIHJlZ2lzdGVyOiBQcm90b2NvbFJlZ2lzdHJhcixcbiAgb25QYWlyOiAobGluazogUGFpckRlZXBMaW5rKSA9PiBQcm9taXNlPHZvaWQ+LFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhbmRsZXI6IFByb3RvY29sSGFuZGxlciA9IChwYXJhbXMpID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXMpO1xuICAgIGlmICghcGFyc2VkLm9rKSB7XG4gICAgICAvLyBNaXNzaW5nIGJvdGggXHUyMTkyIGEgYmFyZSBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cyBoaXQ7IHN0YXkgcXVpZXQuXG4gICAgICBpZiAocGFyc2VkLmVycm9yICE9PSAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJykge1xuICAgICAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmMgZGVlcCBsaW5rOiAke3BhcnNlZC5lcnJvcn1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdm9pZCBvblBhaXIocGFyc2VkLmxpbmspLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcignW3ZzYV0gZGVlcC1saW5rIHBhaXJpbmcgZmFpbGVkJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYWlyaW5nIHZpYSBsaW5rIGZhaWxlZCBcdTIwMTQgc2VlIHRoZSBjb25zb2xlIGZvciBkZXRhaWxzLicpO1xuICAgIH0pO1xuICB9O1xuICByZWdpc3RlcihQUk9UT0NPTF9BQ1RJT04sIGhhbmRsZXIpO1xuICAvLyBSZWdpc3RlciB0aGUgcGF0aC1zcGVsbGVkIGFjdGlvbiB0b28gKGJ1aWxkLWRlcGVuZGVudCBtYXRjaGluZykuXG4gIHJlZ2lzdGVyKGAke1BST1RPQ09MX0FDVElPTn0vcGFpcmAsIGhhbmRsZXIpO1xufVxuIiwgIi8qKlxuICogUmVjb25uZWN0IHBvbGljeSAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBleHBvbmVudGlhbCBiYWNrb2ZmIHdpdGggaml0dGVyLFxuICogY2FwcGVkIGF0IDYwIHMuIFRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljayBhc2tzIHRoZSBzdXBlcnZpc29yIHdoYXRcbiAqIHRvIGRvIHdoZW5ldmVyIHRoZSBjbGllbnQgcmVwb3J0cyBgZGlzY29ubmVjdGVkYDsgYSBzY2hlZHVsZWQgcmVjb25uZWN0IGlzXG4gKiBhIHNpbmdsZSBmbGlnaHQgXHUyMDE0IG5ldmVyIGEgc3RhY2sgb2YgcmV0cmllcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0ZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFja29mZk9wdGlvbnMge1xuICAvKiogRmlyc3QgYXR0ZW1wdCBkZWxheSAoZGVmYXVsdCAxIHMpLiAqL1xuICBiYXNlTXM/OiBudW1iZXI7XG4gIC8qKiBDZWlsaW5nIChkZWZhdWx0IDYwIHMgcGVyIHRoZSBwbHVnaW4gc3BlYykuICovXG4gIGNhcE1zPzogbnVtYmVyO1xuICAvKiogSml0dGVyIGZyYWN0aW9uIGFyb3VuZCB0aGUgZXhwb25lbnRpYWwgdmFsdWUsIDBcdTIwMTMwLjUgKGRlZmF1bHQgMC4zKS4gKi9cbiAgaml0dGVyPzogbnVtYmVyO1xuICAvKiogSW5qZWN0YWJsZSByYW5kb21uZXNzICh0ZXN0cykuIERlZmF1bHQgYE1hdGgucmFuZG9tYC4gKi9cbiAgcmFuZG9tPzogKCkgPT4gbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUyA9IDEwMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TID0gNjBfMDAwO1xuXG4vKipcbiAqIERlbGF5IGZvciBhdHRlbXB0IE4gKDAtYmFzZWQpOiBgbWluKGNhcCwgYmFzZSBcdTAwQjcgMl5hdHRlbXB0KWAgd2l0aCBzeW1tZXRyaWNcbiAqIG11bHRpcGxpY2F0aXZlIGppdHRlciwgZmxvb3JlZCBhdCAyNTAgbXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYWNrb2ZmRGVsYXlNcyhhdHRlbXB0OiBudW1iZXIsIG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zID0ge30pOiBudW1iZXIge1xuICBjb25zdCBiYXNlID0gb3B0aW9ucy5iYXNlTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUztcbiAgY29uc3QgY2FwID0gb3B0aW9ucy5jYXBNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9DQVBfTVM7XG4gIGNvbnN0IGppdHRlciA9IG9wdGlvbnMuaml0dGVyID8/IDAuMztcbiAgY29uc3QgcmFuZG9tID0gb3B0aW9ucy5yYW5kb20gPz8gTWF0aC5yYW5kb207XG4gIGNvbnN0IGV4cG9uZW50aWFsID0gTWF0aC5taW4oY2FwLCBiYXNlICogMiAqKiBhdHRlbXB0KTtcbiAgY29uc3QgZmFjdG9yID0gMSArIChyYW5kb20oKSAqIDIgLSAxKSAqIGppdHRlcjtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oY2FwLCBNYXRoLm1heCgyNTAsIGV4cG9uZW50aWFsICogZmFjdG9yKSkpO1xufVxuXG5leHBvcnQgdHlwZSBSZWNvbm5lY3REZWNpc2lvbiA9IHsgYWN0aW9uOiAncmVjb25uZWN0JzsgZGVsYXlNczogbnVtYmVyIH0gfCB7IGFjdGlvbjogJ3dhaXQnIH07XG5cbi8qKlxuICogVHJhY2tzIHJlY29ubmVjdCBhdHRlbXB0cyBhY3Jvc3MgdGhlIHN1cGVydmlzaW9uIHRpY2suIE5vbi1kaXNjb25uZWN0ZWRcbiAqIHN0YXRlcyByZXNldCB0aGUgYmFja29mZiBsYWRkZXIgKGEgc3VjY2Vzc2Z1bCBjeWNsZSBtZWFucyB0aGUgbmV0d29yayBpc1xuICogYmFjayk7IGBzY2hlZHVsZWRgIGtlZXBzIGV4YWN0bHkgb25lIHJlY29ubmVjdCBpbiBmbGlnaHQuXG4gKi9cbmV4cG9ydCBjbGFzcyBSZWNvbm5lY3RTdXBlcnZpc29yIHtcbiAgcHJpdmF0ZSBhdHRlbXB0ID0gMDtcbiAgcHJpdmF0ZSBzY2hlZHVsZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucztcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgfVxuXG4gIC8qKiBDYWxsIGVhY2ggdGljazsgb24gYHJlY29ubmVjdGAsIGZvbGxvdyB1cCB3aXRoIGBhY2tub3dsZWRnZWQoKWAuICovXG4gIGNvbnNpZGVyKHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUpOiBSZWNvbm5lY3REZWNpc2lvbiB7XG4gICAgaWYgKHN0YXRlICE9PSAnZGlzY29ubmVjdGVkJykge1xuICAgICAgdGhpcy5hdHRlbXB0ID0gMDtcbiAgICAgIHRoaXMuc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgICByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIH1cbiAgICBpZiAodGhpcy5zY2hlZHVsZWQpIHJldHVybiB7IGFjdGlvbjogJ3dhaXQnIH07XG4gICAgcmV0dXJuIHsgYWN0aW9uOiAncmVjb25uZWN0JywgZGVsYXlNczogYmFja29mZkRlbGF5TXModGhpcy5hdHRlbXB0LCB0aGlzLm9wdGlvbnMpIH07XG4gIH1cblxuICAvKiogTWFyayB0aGUgcmV0dXJuZWQgcmVjb25uZWN0IGFzIGluIGZsaWdodCAob25lIGF0IGEgdGltZSkuICovXG4gIGFja25vd2xlZGdlZCgpOiB2b2lkIHtcbiAgICB0aGlzLmF0dGVtcHQgKz0gMTtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IHRydWU7XG4gIH1cblxuICAvKiogVGhlIGluLWZsaWdodCByZWNvbm5lY3Qgc2V0dGxlZCAoc3VjY2VzcyBvciBmYWlsdXJlKS4gKi9cbiAgc2V0dGxlZCgpOiB2b2lkIHtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICB9XG5cbiAgLyoqIENvbXBsZXRlZCByZWNvbm5lY3QgYXR0ZW1wdHMgc2luY2UgdGhlIGxhc3QgaGVhbHRoeSBzdGF0ZS4gKi9cbiAgZ2V0IGF0dGVtcHRzKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYXR0ZW1wdDtcbiAgfVxufVxuIiwgIi8qKlxuICogVGhlIHNldHRpbmdzIHRhYiAocGx1Z2luIHNjb3BlIGl0ZW0gIzYpOiB3b3JrZXIgVVJMICsgZGV2aWNlIG5hbWUgK1xuICogcGFpcmluZyBjb2RlICsgXCJQYWlyXCIgKHdpdGggdW5jbGFpbWVkLXdvcmtlciBvbmJvYXJkaW5nIGd1aWRhbmNlKSwgXCJTeW5jXG4gKiBub3dcIiwgdW5saW5rLXdpdGgtY29uZmlybSwgcmVzY2FuLWludGVydmFsIGFuZCBgLm9ic2lkaWFuL2AgdG9nZ2xlcywgYW5kIGFcbiAqIGxpdmUgc3RhdHVzIHJlYWRvdXQgKGNvbm5lY3RlZCwgbGFzdCBzeW5jLCBwZW5kaW5nLCBjb25mbGljdHMpLlxuICpcbiAqIEFsbCBsb2dpYyBsaXZlcyBvbiBgVmF1bHRTeW5jUGx1Z2luYDsgdGhlIHRhYiBpcyBwcmVzZW50YXRpb24gcGx1cyB3aXJpbmcuXG4gKi9cblxuaW1wb3J0IHsgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZyB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTLFxuICB0eXBlIFZhdWx0U3luY1BsdWdpbkRhdGEsXG59IGZyb20gJy4vZGF0YS5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRTaW5jZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB0eXBlIHsgVmF1bHRTeW5jUGx1Z2luIH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuXG4vKipcbiAqIENsb3VkZmxhcmUgRGVwbG95IEJ1dHRvbiB0YXJnZXQgKEZSLTIxKTogcHJvdmlzaW9ucyBhIHByZWNvbmZpZ3VyZWQgd29ya2VyXG4gKiArIER1cmFibGUgT2JqZWN0ICsgUjIgYnVja2V0IGluIHRoZSB1c2VyJ3Mgb3duIGFjY291bnQgXHUyMDE0IG5vIHdyYW5nbGVyLCBub1xuICogbWFudWFsIGNvbmZpZy4gVGhlIHRlbXBsYXRlIHJlcG8gcGlucyBhIHJlbGVhc2VkIHdvcmtlciB2ZXJzaW9uLlxuICovXG5leHBvcnQgY29uc3QgREVQTE9ZX1VSTCA9XG4gICdodHRwczovL2RlcGxveS53b3JrZXJzLmNsb3VkZmxhcmUuY29tLz91cmw9JyArXG4gICdodHRwczovL2dpdGh1Yi5jb20vdmF1bHRzeW5jZm9yYWdlbnRzL3ZhdWx0c3luY2ZvcmFnZW50cy10ZW1wbGF0ZSc7XG5cbi8qKiBPcGVuIHRoZSBkZXBsb3kgcGFnZSBpbiB0aGUgc3lzdGVtIGJyb3dzZXIgKG5vLW9wIHdoZXJlIGB3aW5kb3dgIGlzIGFic2VudCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlbkRlcGxveVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihERVBMT1lfVVJMLCAnX2JsYW5rJyk7XG59XG5cbi8qKiBTbWFsbCBjb25maXJtYXRpb24gZGlhbG9nICh0aGUgdW5saW5rIGJ1dHRvbidzIHNhZmV0eSBuZXQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZpcm1Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgYm9keTogc3RyaW5nO1xuICAgICAgY29uZmlybVRleHQ6IHN0cmluZztcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD47XG4gICAgfSxcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG92ZXJyaWRlIG9uT3BlbigpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZSh0aGlzLm9wdGlvbnMudGl0bGUpLnNldERlc2ModGhpcy5vcHRpb25zLmJvZHkpO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDYW5jZWwnKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSksXG4gICAgKTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KHRoaXMub3B0aW9ucy5jb25maXJtVGV4dClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdGlvbnMub25Db25maXJtKCk7XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFZhdWx0U3luY1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IFZhdWx0U3luY1BsdWdpbjtcbiAgLyoqIFBhaXJpbmcgY29kZXMgbmV2ZXIgdG91Y2ggZGlzayBcdTIwMTQgdGhleSBhcmUgb25lLXRpbWUsIHNob3J0LWxpdmVkIHNlY3JldHMuICovXG4gIHByaXZhdGUgcGFpcmluZ0NvZGUgPSAnJztcbiAgcHJpdmF0ZSBoaW50U2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c1NldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWZyZXNoSGFuZGxlOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBWYXVsdFN5bmNQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvdmVycmlkZSBkaXNwbGF5KCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgdGhpcy5oaW50U2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbnVsbDtcblxuICAgIHRoaXMucmVuZGVyQ29ubmVjdGlvblNlY3Rpb24oKTtcbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICB0aGlzLnJlbmRlckxpbmtlZFNlY3Rpb24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nU2VjdGlvbigpO1xuICAgIH1cbiAgICB0aGlzLnN0YXJ0UmVmcmVzaCgpO1xuICB9XG5cbiAgb3ZlcnJpZGUgaGlkZSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gIH1cblxuICAvLyAtLS0gc2VjdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnV29ya2VyIFVSTCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1lvdXIgc3luYyB3b3JrZXIsIGUuZy4gaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2LiBObyB3b3JrZXIgeWV0PyBVc2UgXCJEZXBsb3kgeW91ciB3b3JrZXJcIiBiZWxvdywgb3BlbiB0aGUgVVJMIGluIGEgYnJvd3NlciwgYW5kIGNsYWltIGl0LicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2JylcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS51cmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS51cmwgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKGBTaG93biBpbiB0aGUgd29ya2VyIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiBBcHBsaWVzIHdoZW4gKHJlKXBhaXJpbmcuYClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHREZXZpY2VOYW1lKCkpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQYWlyaW5nIGNvZGUnKVxuICAgICAgLnNldERlc2MoJ0Zyb20geW91ciB3b3JrZXIgZGFzaGJvYXJkOiBEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UuIENvZGVzIGFyZSBvbmUtdGltZSBhbmQgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCc3RjNLLVE5TTInKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGFpcmluZ0NvZGUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCgnUGFpciB0aGlzIHZhdWx0JylcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHRoaXMucGx1Z2luLnBhaXJGcm9tU2V0dGluZ3ModGhpcy5wYWlyaW5nQ29kZSk7XG4gICAgICAgICAgICB0aGlzLnNob3dPdXRjb21lKG91dGNvbWUpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuaGludFNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdHZXR0aW5nIHN0YXJ0ZWQnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc2V0dGluZ3MtaGludCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgW1xuICAgICAgICAgICcxLiBEZXBsb3kgeW91ciBvd24gd29ya2VyIHdpdGggdGhlIGJ1dHRvbiBiZWxvdyAoeW91ciBDbG91ZGZsYXJlIGFjY291bnQsIHByZWNvbmZpZ3VyZWQgXHUyMDE0IG5vIHdyYW5nbGVyKS4nLFxuICAgICAgICAgICcyLiBPcGVuIHRoZSB3b3JrZXIgVVJMIGluIGEgYnJvd3NlciBhbmQgc2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIChjbGFpbSkuJyxcbiAgICAgICAgICAnMy4gQ3JlYXRlIGEgcGFpcmluZyBjb2RlIG9uIHRoZSBkYXNoYm9hcmQsIHBhc3RlIGl0IGFib3ZlLCBhbmQgcGFpci4nLFxuICAgICAgICAgICdPbiBhIHBob25lLCBzY2FubmluZyB0aGUgZGFzaGJvYXJkIFFSIG9yIHRhcHBpbmcgaXRzIG9ic2lkaWFuOi8vIGxpbmsgcGFpcnMgd2l0aG91dCB0eXBpbmcuJyxcbiAgICAgICAgXS5qb2luKCdcXG4nKSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0RlcGxveSB5b3VyIHdvcmtlcicpLm9uQ2xpY2soKCkgPT4gb3BlbkRlcGxveVBhZ2UoKSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG5cbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc3RhdHVzLXJlYWRvdXQnKVxuICAgICAgLnNldERlc2ModGhpcy5zdGF0dXNUZXh0KCkpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1N5bmMgbm93Jykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zeW5jTm93KCk7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB0aGlzLnJlZnJlc2hTdGF0dXMoKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1Jlc2NhbiBpbnRlcnZhbCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1BlcmlvZGljIGZ1bGwgcmVjb25jaWxpYXRpb24gXHUyMDE0IGNhdGNoZXMgZXh0ZXJuYWwgZWRpdHMgd2hpbGUgT2JzaWRpYW4gaXMgb3BlbiBhbmQgY292ZXJzIG1vYmlsZSBiYWNrZ3JvdW5kIGxpbWl0cy4gVmF1bHQgZXZlbnRzIGFuZCBhcHAtb3BlbiBzeW5jIGFsd2F5cyBydW4uJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBjaG9pY2Ugb2YgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMpIHtcbiAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oU3RyaW5nKGNob2ljZS52YWx1ZSksIGNob2ljZS5sYWJlbCk7XG4gICAgICAgIH1cbiAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoU3RyaW5nKGRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlSZXNjYW5JbnRlcnZhbChOdW1iZXIodmFsdWUpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N5bmMgLm9ic2lkaWFuLyBmb2xkZXInKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdPcHQgaW4gdG8gc3luY2luZyAub2JzaWRpYW4vIChzZXR0aW5ncyBhbmQgcGx1Z2lucyksIGV4Y2x1ZGluZyB3b3Jrc3BhY2UuanNvbiBhbmQgY2FjaGVzLiAnICtcbiAgICAgICAgICAnVGhlIHdvcmtlclxcdTIwMTlzIHBlci12YXVsdCBzZXR0aW5nIHRha2VzIHByZWNlZGVuY2Ugb25jZSBjb25uZWN0ZWQuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseU9ic2lkaWFuU3luYyh2YWx1ZSk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdVbmxpbmsgdGhpcyB2YXVsdCcpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICAgICAgdGl0bGU6ICdVbmxpbmsgVmF1bHRTeW5jPycsXG4gICAgICAgICAgYm9keTogJ1RoaXMgc3RvcHMgc3luY2luZyBhbmQgY2xlYXJzIHRoaXMgZGV2aWNlXFx1MjAxOXMgbG9jYWwgc3luYyBzdGF0ZS4gRmlsZXMgYWxyZWFkeSBpbiB0aGUgdmF1bHQgYXJlIHVudG91Y2hlZC4gVGhlIHdvcmtlciBrZWVwcyB0aGlzIGRldmljZSBpbiBpdHMgcmVnaXN0cnkgXFx1MjAxNCByZXZva2UgaXQgZnJvbSB0aGUgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgICAgICAgY29uZmlybVRleHQ6ICdVbmxpbmsnLFxuICAgICAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4udW5saW5rKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KS5vcGVuKCk7XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgLy8gLS0tIHN0YXR1cyAvIGZlZWRiYWNrIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBzdGF0dXNUZXh0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBpZiAoc3RhdHVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBgTGlua2VkIHRvICR7ZGF0YS51cmx9IChkZXZpY2UgJHtkYXRhLmRldmljZU5hbWUgfHwgZGF0YS5kZXZpY2VJZH0pLmA7XG4gICAgfVxuICAgIGNvbnN0IGxhc3RTeW5jID1cbiAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICAgID8gJ25ldmVyJ1xuICAgICAgICA6IGAke2Zvcm1hdFNpbmNlKERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2A7XG4gICAgY29uc3Qgc3RhdGUgPSBzdGF0dXMuc3RhdGUgPT09ICdsaXZlJyA/ICdjb25uZWN0ZWQnIDogc3RhdHVzLnN0YXRlO1xuICAgIHJldHVybiBbXG4gICAgICBgU3RhdGU6ICR7c3RhdGV9YCxcbiAgICAgIGBXb3JrZXI6ICR7ZGF0YS51cmx9YCxcbiAgICAgIGBMYXN0IHN5bmM6ICR7bGFzdFN5bmN9YCxcbiAgICAgIGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9JHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDAgPyAnIChjb25mbGljdCBjb3BpZXMgd2VyZSB3cml0dGVuIGludG8gdGhlIHZhdWx0KScgOiAnJ31gLFxuICAgIF0uam9pbignXFxuJyk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hTdGF0dXMoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nPy5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcbiAgfVxuXG4gIC8qKiBQYWlyIGZlZWRiYWNrOiBzdWNjZXNzIHJlLXJlbmRlcnM7IGZhaWx1cmVzIGxhbmQgaW4gdGhlIGhpbnQgU2V0dGluZy4gKi9cbiAgcHJpdmF0ZSBzaG93T3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHZvaWQge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyA9PT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpKTtcbiAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlID0gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpO1xuICAgIG5ldyBOb3RpY2UobWVzc2FnZSwgMTAwMDApO1xuICAgIGlmICh0aGlzLmhpbnRTZXR0aW5nICE9PSBudWxsKSB0aGlzLmhpbnRTZXR0aW5nLnNldERlc2MobWVzc2FnZSk7XG4gIH1cblxuICAvLyAtLS0gbGl2ZSByZWZyZXNoIGxvb3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJlZnJlc2ggdGhlIHN0YXR1cyByZWFkb3V0IH4xIEh6IHdoaWxlIHRoZSB0YWIgaXMgb3Blbi4gKi9cbiAgcHJpdmF0ZSBzdGFydFJlZnJlc2goKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IGhhbmRsZSA9IHNldEludGVydmFsKCgpID0+IHRoaXMucmVmcmVzaFN0YXR1cygpLCAxMDAwKTtcbiAgICB0aGlzLnJlZnJlc2hIYW5kbGUgPSBoYW5kbGU7XG4gICAgLy8gT2JzaWRpYW4gY2xlYXJzIHJlZ2lzdGVyZWQgaW50ZXJ2YWxzIHdoZW4gdGhlIHBsdWdpbiB1bmxvYWRzIFx1MjAxNCBubyBsZWFrXG4gICAgLy8gZXZlbiBpZiB0aGUgc2V0dGluZ3MgbW9kYWwgaXMgZm9yY2UtY2xvc2VkLlxuICAgIHRoaXMucGx1Z2luLnJlZ2lzdGVySW50ZXJ2YWwoaGFuZGxlIGFzIHVua25vd24gYXMgbnVtYmVyKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcFJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVmcmVzaEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnJlZnJlc2hIYW5kbGUpO1xuICAgICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIFN0YXR1cy1iYXIgaW5kaWNhdG9yIChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGEgc21hbGwgcGFzc2l2ZSB2aWV3IG92ZXJcbiAqIGBTeW5jQ2xpZW50U3RhdHVzYCwgcmVwYWludGVkIGJ5IHRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljay5cbiAqXG4gKiAgIHZzYSBcdTIyRUYgICAgICAgICAgICAgIGNvbm5lY3RpbmcgLyBzeW5jaW5nXG4gKiAgIHZzYSBcdTI3MTMgMTJzICAgICAgICAgIGxpdmUsIGxhc3QgY29tcGxldGVkIGN5Y2xlIDEyIHMgYWdvXG4gKiAgIHZzYSBcdTI2QTAgY29uZmxpY3RzOiAyIGNvbmZsaWN0cyBvYnNlcnZlZCAoY29uZmxpY3QgY29waWVzIGV4aXN0IGluIHRoZSB2YXVsdClcbiAqICAgdnNhIFx1MjcxNyBvZmZsaW5lICAgICAgZGlzY29ubmVjdGVkIChyZWNvbm5lY3QgYmFja29mZiBydW5uaW5nKVxuICpcbiAqIFRoZSB0b29sdGlwIGNhcnJpZXMgdGhlIGRldGFpbDogc3RhdGUsIHdvcmtlciBVUkwsIGRldmljZSwgbGFzdCBzeW5jLCBwZW5kaW5nLlxuICovXG5cbmltcG9ydCB0eXBlIHsgU3luY0NsaWVudFN0YXR1cyB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBUaGUgc2xpY2Ugb2YgSFRNTEVsZW1lbnQgdGhlIGluZGljYXRvciB0b3VjaGVzICh0ZXN0cyBwYXNzIGEgcGxhaW4gb2JqZWN0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzSXRlbUxpa2Uge1xuICB0ZXh0Q29udGVudDogc3RyaW5nO1xuICBhZGRDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICByZW1vdmVDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICBzZXRBdHRyaWJ1dGU/KG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHVua25vd247XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzQ29udGV4dCB7XG4gIHVybDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFeHRyYSBsaW5lIChlLmcuIGFuIGF1dGggZmFpbHVyZSBub3RlKSBhcHBlbmRlZCB0byB0aGUgdG9vbHRpcC4gKi9cbiAgbm90ZT86IHN0cmluZztcbn1cblxuLyoqIGBub3cgLSBzaW5jZWAsIGZsb29yZWQ6IGAxMnNgLCBgNW1gLCBgM2hgIFx1MjAxNCBkaXNwbGF5IG9ubHkuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0U2luY2UoZWxhcHNlZE1zOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzZWNvbmRzID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihlbGFwc2VkTXMgLyAxMDAwKSk7XG4gIGlmIChzZWNvbmRzIDwgNjApIHJldHVybiBgJHtzZWNvbmRzfXNgO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gNjApO1xuICBpZiAobWludXRlcyA8IDYwKSByZXR1cm4gYCR7bWludXRlc31tYDtcbiAgcmV0dXJuIGAke01hdGguZmxvb3IobWludXRlcyAvIDYwKX1oYDtcbn1cblxuLyoqIFRoZSBvbmUtbGluZSBzdGF0dXMgdGV4dCBmb3IgYSBjbGllbnQgc3RhdHVzIGF0IHRpbWUgYG5vd2AuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzTGluZUZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgc3dpdGNoIChzdGF0dXMuc3RhdGUpIHtcbiAgICBjYXNlICdjb25uZWN0aW5nJzpcbiAgICBjYXNlICdzeW5jaW5nJzpcbiAgICAgIHJldHVybiAndnNhIFx1MjJFRic7XG4gICAgY2FzZSAnZGlzY29ubmVjdGVkJzpcbiAgICAgIHJldHVybiAndnNhIFx1MjcxNyBvZmZsaW5lJztcbiAgICBjYXNlICdsaXZlJzpcbiAgICAgIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHJldHVybiBgdnNhIFx1MjZBMCBjb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YDtcbiAgICAgIGlmIChzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCkgcmV0dXJuICd2c2EgXHUyNzEzJztcbiAgICAgIHJldHVybiBgdnNhIFx1MjcxMyAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX1gO1xuICAgIGNhc2UgJ2lkbGUnOlxuICAgICAgcmV0dXJuICd2c2EnO1xuICB9XG59XG5cbi8qKiBUb29sdGlwIGxpbmVzIChqb2luZWQgd2l0aCBgXFxuYCkuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzVG9vbHRpcEZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdGVMYWJlbDogUmVjb3JkPFN5bmNDbGllbnRTdGF0dXNbJ3N0YXRlJ10sIHN0cmluZz4gPSB7XG4gICAgaWRsZTogJ25vdCBydW5uaW5nJyxcbiAgICBjb25uZWN0aW5nOiAnY29ubmVjdGluZ1x1MjAyNicsXG4gICAgc3luY2luZzogJ3N5bmNpbmdcdTIwMjYnLFxuICAgIGxpdmU6ICdsaXZlJyxcbiAgICBkaXNjb25uZWN0ZWQ6ICdvZmZsaW5lIFx1MjAxNCByZWNvbm5lY3RpbmcnLFxuICB9O1xuICBjb25zdCBsaW5lcyA9IFtgVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0ICR7c3RhdGVMYWJlbFtzdGF0dXMuc3RhdGVdfWBdO1xuICBpZiAoY29udGV4dC51cmwgIT09ICcnKSBsaW5lcy5wdXNoKGBXb3JrZXI6ICR7Y29udGV4dC51cmx9YCk7XG4gIGlmIChjb250ZXh0LmRldmljZU5hbWUgIT09ICcnKSBsaW5lcy5wdXNoKGBEZXZpY2U6ICR7Y29udGV4dC5kZXZpY2VOYW1lfWApO1xuICBsaW5lcy5wdXNoKFxuICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICA/ICdMYXN0IHN5bmM6IG5ldmVyJ1xuICAgICAgOiBgTGFzdCBzeW5jOiAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX0gYWdvYCxcbiAgKTtcbiAgbGluZXMucHVzaChgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWApO1xuICBsaW5lcy5wdXNoKGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCk7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICBsaW5lcy5wdXNoKGBDb25mbGljdCBjb3BpZXM6ICR7c3RhdHVzLmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkuam9pbignLCAnKX1gKTtcbiAgfVxuICBpZiAoY29udGV4dC5ub3RlICE9PSB1bmRlZmluZWQgJiYgY29udGV4dC5ub3RlICE9PSAnJykgbGluZXMucHVzaChjb250ZXh0Lm5vdGUpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBDU1MgbW9kaWZpZXIgZm9yIHRoZSBpbmRpY2F0b3IgKHRpbnRlZCB3YXJuaW5nL2Vycm9yIHN0YXRlcykuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogc3RyaW5nIHtcbiAgaWYgKHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCcpIHJldHVybiAndnNhLWVycm9yJztcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkgcmV0dXJuICd2c2Etd2Fybic7XG4gIHJldHVybiAnJztcbn1cblxuLyoqXG4gKiBQYWludHMgb25lIHN0YXR1cy1iYXIgaXRlbS4gUGFzc2l2ZTogdGhlIHBsdWdpbiBjYWxscyBgdXBkYXRlKClgIGZyb20gaXRzXG4gKiBzdXBlcnZpc2lvbiB0aWNrIFx1MjAxNCBubyB0aW1lcnMgb2YgaXRzIG93biB0byBsZWFrLlxuICovXG5leHBvcnQgY2xhc3MgU3RhdHVzQmFySW5kaWNhdG9yIHtcbiAgLyoqIEFsd2F5cyBvbiBcdTIwMTQgdGhlIGJhc2UgY2xhc3Mgc3R5bGVzLmNzcyB0YXJnZXRzLiAqL1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBCQVNFX0NMQVNTID0gJ3ZzYS1zdGF0dXMnO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNT0RJRklFUl9DTEFTU0VTID0gWyd2c2Etd2FybicsICd2c2EtZXJyb3InXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGl0ZW06IFN0YXR1c0l0ZW1MaWtlKSB7fVxuXG4gIHVwZGF0ZShzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pdGVtLnRleHRDb250ZW50ID0gc3RhdHVzTGluZUZvcihzdGF0dXMsIG5vdyk7XG4gICAgdGhpcy5pdGVtLmFkZENsYXNzPy4oU3RhdHVzQmFySW5kaWNhdG9yLkJBU0VfQ0xBU1MpO1xuICAgIGNvbnN0IG1vZGlmaWVyID0gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzKTtcbiAgICBmb3IgKGNvbnN0IGNscyBvZiBTdGF0dXNCYXJJbmRpY2F0b3IuTU9ESUZJRVJfQ0xBU1NFUykge1xuICAgICAgaWYgKGNscyA9PT0gbW9kaWZpZXIpIHRoaXMuaXRlbS5hZGRDbGFzcz8uKGNscyk7XG4gICAgICBlbHNlIHRoaXMuaXRlbS5yZW1vdmVDbGFzcz8uKGNscyk7XG4gICAgfVxuICAgIHRoaXMuaXRlbS5zZXRBdHRyaWJ1dGU/LigndGl0bGUnLCBzdGF0dXNUb29sdGlwRm9yKHN0YXR1cywgY29udGV4dCwgbm93KSk7XG4gIH1cbn1cbiIsICIvKipcbiAqIGBXZWJTb2NrZXRUcmFuc3BvcnRgIFx1MjAxNCBjb3JlJ3MgYFRyYW5zcG9ydGAgb3ZlciB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgXG4gKiAocHJlc2VudCBpbiBPYnNpZGlhbiBkZXNrdG9wICphbmQqIG1vYmlsZTsgZmVhdHVyZS1jaGVja2VkIHdpdGggYSBjbGVhclxuICogZXJyb3IgZm9yIGV4b3RpYyBidWlsZHMpLlxuICpcbiAqIFRoaXMgbWlycm9ycyBgQHZzYS9ub2RlLXJ1bnRpbWVgJ3MgdHJhbnNwb3J0IG9uIHB1cnBvc2UgKHNhbWUgd2lyZSBmb3JtYXQ6XG4gKiBvbmUgSlNPTiB0ZXh0IGZyYW1lIHBlciBtZXNzYWdlLCBjb3JlJ3MgYHBhcnNlTWVzc2FnZWAgb24gcmVjZWl2ZSwgcXVldWVkXG4gKiBzZW5kcyBiZWZvcmUgb3BlbikgYnV0IHNoYXJlcyBubyBjb2RlIHdpdGggaXQgXHUyMDE0IGBAdnNhL25vZGUtcnVudGltZWAgaXNcbiAqIE5vZGUtb25seSBhbmQgbXVzdCBuZXZlciBiZSBhIHBsdWdpbiBkZXBlbmRlbmN5LlxuICovXG5cbmltcG9ydCB7IE5ldHdvcmtFcnJvciwgcGFyc2VNZXNzYWdlIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgQ2xvc2VSZWFzb24sIE1lc3NhZ2UsIFRyYW5zcG9ydCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKlxuICogVGhlIG1pbmltYWwgV2ViU29ja2V0IHN1cmZhY2UgdGhpcyB0cmFuc3BvcnQgbmVlZHMuIEluamVjdGFibGUgc28gdGVzdHNcbiAqIChhbmQgZXhvdGljIHJ1bnRpbWVzKSBjYW4gc3VwcGx5IGEgZmFrZTsgcHJvZHVjdGlvbiB1c2VzIHRoZSBnbG9iYWwuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0TGlrZSB7XG4gIHNlbmQoZGF0YTogc3RyaW5nKTogdm9pZDtcbiAgY2xvc2UoY29kZT86IG51bWJlciwgcmVhc29uPzogc3RyaW5nKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnb3BlbicsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnbWVzc2FnZScsIGxpc3RlbmVyOiAoZXZlbnQ6IHsgZGF0YTogdW5rbm93biB9KSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnY2xvc2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGNvZGU/OiBudW1iZXI7IHJlYXNvbj86IHN0cmluZyB9KSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnZXJyb3InLCBsaXN0ZW5lcjogKGV2ZW50OiB1bmtub3duKSA9PiB2b2lkKTogdm9pZDtcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0RmFjdG9yeSA9ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4gKGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgKSBvciBhIGB3cyhzKTovL2AgVVJMLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIERldmljZSB0b2tlbiBcdTIwMTQgY2FycmllZCBpbiB0aGUgcXVlcnkgc3RyaW5nICh0aGUgd29ya2VyJ3MgcHJlLWF1dGggcGF0aCkuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBXUyBwYXRoIG9uIHRoZSB3b3JrZXIgKGRlZmF1bHQgYC93c2A7IGAvc3luY2AgaXMgZXF1aXZhbGVudCkuICovXG4gIHBhdGg/OiBzdHJpbmc7XG4gIC8qKiBJbmplY3RhYmxlIHNvY2tldCBmYWN0b3J5ICh0ZXN0cykuIERlZmF1bHQ6IHRoZSBnbG9iYWwgYFdlYlNvY2tldGAuICovXG4gIHdzRmFjdG9yeT86IFdlYlNvY2tldEZhY3Rvcnk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIGF1dGhlbnRpY2F0ZWQgV1MgVVJMOiBgaHR0cHM6Ly94YCBcdTIxOTIgYHdzczovL3gvd3M/dG9rZW49XHUyMDI2YC5cbiAqIFRocm93cyBvbiBub24tSFRUUChTKS9XUyBzY2hlbWVzIG9yIHVucGFyc2FibGUgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1dlYlNvY2tldFVybChiYXNlVXJsOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcsIHBhdGggPSAnL3dzJyk6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoYmFzZVVybCk7XG4gIGlmICh1cmwucHJvdG9jb2wgPT09ICdodHRwOicpIHVybC5wcm90b2NvbCA9ICd3czonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgPT09ICdodHRwczonKSB1cmwucHJvdG9jb2wgPSAnd3NzOic7XG4gIGVsc2UgaWYgKHVybC5wcm90b2NvbCAhPT0gJ3dzOicgJiYgdXJsLnByb3RvY29sICE9PSAnd3NzOicpIHtcbiAgICB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKGB3b3JrZXIgVVJMIG11c3QgYmUgaHR0cChzKTovLyBvciB3cyhzKTovLywgZ290ICR7dXJsLnByb3RvY29sfWApO1xuICB9XG4gIHVybC5wYXRobmFtZSA9IHBhdGg7XG4gIHVybC5zZWFyY2ggPSAnJztcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3Rva2VuJywgdG9rZW4pO1xuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5KHVybDogc3RyaW5nKTogV2ViU29ja2V0TGlrZSB7XG4gIGNvbnN0IHdlYnNvY2tldCA9IChnbG9iYWxUaGlzIGFzIHsgV2ViU29ja2V0PzogdW5rbm93biB9KS5XZWJTb2NrZXQ7XG4gIGlmICh0eXBlb2Ygd2Vic29ja2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihcbiAgICAgICdXZWJTb2NrZXQgaXMgbm90IGF2YWlsYWJsZSBpbiB0aGlzIE9ic2lkaWFuIGJ1aWxkIChpdCBpcyBidWlsdCBpbiBvbiBkZXNrdG9wIGFuZCAnICtcbiAgICAgICAgJ21vYmlsZTsgYSB2ZXJ5IG9sZCBhcHAgdmVyc2lvbiBvciBhIHN0cmlwcGVkIHdlYnZpZXcgaXMgdGhlIG9ubHkga25vd24gY2F1c2UpLiAnICtcbiAgICAgICAgJ1N5bmMgcmVxdWlyZXMgaXQuJyxcbiAgICApO1xuICB9XG4gIHJldHVybiBuZXcgKHdlYnNvY2tldCBhcyBuZXcgKHVybDogc3RyaW5nKSA9PiBXZWJTb2NrZXRMaWtlKSh1cmwpO1xufVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0VHJhbnNwb3J0IGltcGxlbWVudHMgVHJhbnNwb3J0IHtcbiAgcHJpdmF0ZSByZWFkb25seSBzb2NrZXQ6IFdlYlNvY2tldExpa2U7XG4gIHByaXZhdGUgbWVzc2FnZUNhbGxiYWNrOiAoKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2xvc2VDYWxsYmFjazogKChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG9wZW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBjbG9zZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBjbG9zZU5vdGlmaWVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VuZFF1ZXVlOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIGxhc3RFcnJvcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFdlYlNvY2tldFRyYW5zcG9ydE9wdGlvbnMpIHtcbiAgICBjb25zdCBmYWN0b3J5ID0gb3B0aW9ucy53c0ZhY3RvcnkgPz8gZGVmYXVsdFdlYlNvY2tldEZhY3Rvcnk7XG4gICAgY29uc3QgdXJsID0gdG9XZWJTb2NrZXRVcmwob3B0aW9ucy51cmwsIG9wdGlvbnMudG9rZW4sIG9wdGlvbnMucGF0aCA/PyAnL3dzJyk7XG4gICAgdGhpcy5zb2NrZXQgPSBmYWN0b3J5KHVybCk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdvcGVuJywgKCkgPT4ge1xuICAgICAgdGhpcy5vcGVuID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHF1ZXVlZCA9IFsuLi50aGlzLnNlbmRRdWV1ZV07XG4gICAgICB0aGlzLnNlbmRRdWV1ZS5sZW5ndGggPSAwO1xuICAgICAgZm9yIChjb25zdCBmcmFtZSBvZiBxdWV1ZWQpIHRoaXMuc29ja2V0LnNlbmQoZnJhbWUpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBldmVudC5kYXRhICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aGlzLmZhaWwoeyBjb2RlOiAxMDAzLCByZWFzb246ICdiaW5hcnkgZnJhbWVzIGFyZSBub3QgcGFydCBvZiB0aGUgcHJvdG9jb2wnIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBsZXQgbWVzc2FnZTogTWVzc2FnZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIG1lc3NhZ2UgPSBwYXJzZU1lc3NhZ2UoZXZlbnQuZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmZhaWwoeyBjb2RlOiAxMDAyLCByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2s/LihtZXNzYWdlKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLmxhc3RFcnJvciA9XG4gICAgICAgIGV2ZW50IGluc3RhbmNlb2YgRXJyb3IgPyBldmVudC5tZXNzYWdlIDogZXZlbnQgIT09IHVuZGVmaW5lZCA/IFN0cmluZyhldmVudCkgOiAnc29ja2V0IGVycm9yJztcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2Nsb3NlJywgKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLmZpbmlzaENsb3NlKHtcbiAgICAgICAgY29kZTogZXZlbnQuY29kZSxcbiAgICAgICAgcmVhc29uOiBldmVudC5yZWFzb24gIT09IHVuZGVmaW5lZCAmJiBldmVudC5yZWFzb24gIT09ICcnID8gZXZlbnQucmVhc29uIDogdGhpcy5sYXN0RXJyb3IsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHNlbmQobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQge1xuICAgIGlmICh0aGlzLmNsb3NlZCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignc2VuZCBvbiBhIGNsb3NlZCB0cmFuc3BvcnQnKTtcbiAgICBjb25zdCBmcmFtZSA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIGlmICh0aGlzLm9wZW4pIHtcbiAgICAgIHRoaXMuc29ja2V0LnNlbmQoZnJhbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnNlbmRRdWV1ZS5wdXNoKGZyYW1lKTtcbiAgfVxuXG4gIG9uTWVzc2FnZShjYWxsYmFjazogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLm1lc3NhZ2VDYWxsYmFjayA9IGNhbGxiYWNrO1xuICB9XG5cbiAgb25DbG9zZShjYWxsYmFjazogKHJlYXNvbjogQ2xvc2VSZWFzb24pID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmNsb3NlZCkgcmV0dXJuO1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICB0aGlzLnNlbmRRdWV1ZS5sZW5ndGggPSAwO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnNvY2tldC5jbG9zZSgxMDAwLCAnY2xvc2VkIGJ5IGNhbGxlcicpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBkZWFkIFx1MjAxNCB0aGUgY2xvc2UgZXZlbnQgbWF5IG5ldmVyIGFycml2ZVxuICAgIH1cbiAgICAvLyBOb3RpZnkgZXZlbiBpZiB0aGUgc29ja2V0IG5ldmVyIGVtaXRzICdjbG9zZScgKGZhaWxlZCBkaWFsKS5cbiAgICB0aGlzLmZpbmlzaENsb3NlKHsgY29kZTogMTAwMCwgcmVhc29uOiAnY2xvc2VkIGJ5IGNhbGxlcicgfSk7XG4gIH1cblxuICBwcml2YXRlIGZhaWwocmVhc29uOiBDbG9zZVJlYXNvbik6IHZvaWQge1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UocmVhc29uLmNvZGUgPz8gMTAwMiwgcmVhc29uLnJlYXNvbiA/PyAnJyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBhbHJlYWR5IGNsb3NlZFxuICAgIH1cbiAgICB0aGlzLmZpbmlzaENsb3NlKHJlYXNvbik7XG4gIH1cblxuICBwcml2YXRlIGZpbmlzaENsb3NlKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLm9wZW4gPSBmYWxzZTtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgaWYgKHRoaXMuY2xvc2VOb3RpZmllZCkgcmV0dXJuO1xuICAgIHRoaXMuY2xvc2VOb3RpZmllZCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrPy4ocmVhc29uKTtcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUNjQSxJQUFBQSxtQkFBK0I7OztBQ0t4QixJQUFNLHdCQUFOLGNBQW9DLE1BQU07QUFBQSxFQUMvQyxZQUFZLFNBQWlCO0FBQzNCLFVBQU0sT0FBTztBQUNiLFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQWFPLFNBQVMsbUJBQW1CLE9BQTBCO0FBQzNELE1BQUksT0FBTyxVQUFVLFVBQVU7QUFDN0IsVUFBTSxJQUFJLHNCQUFzQixvQ0FBb0MsT0FBTyxLQUFLLEVBQUU7QUFBQSxFQUNwRjtBQUNBLE1BQUksTUFBTSxTQUFTLElBQUksR0FBRztBQUN4QixVQUFNLElBQUksc0JBQXNCLGlDQUFpQyxLQUFLLFVBQVUsS0FBSyxDQUFDLEVBQUU7QUFBQSxFQUMxRjtBQUNBLE1BQUksYUFBYSxLQUFLLEtBQUssR0FBRztBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSLGdFQUFnRSxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDdkY7QUFBQSxFQUNGO0FBQ0EsTUFBSSxNQUFNLFdBQVcsTUFBTSxHQUFHO0FBQzVCLFVBQU0sSUFBSTtBQUFBLE1BQ1Isc0NBQXNDLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxJQUM3RDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFlBQVksTUFBTSxRQUFRLE9BQU8sR0FBRztBQUMxQyxNQUFJLFVBQVUsV0FBVyxJQUFJLEdBQUc7QUFDOUIsVUFBTSxJQUFJO0FBQUEsTUFDUixxRUFBcUUsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQzVGO0FBQUEsRUFDRjtBQUVBLFFBQU0sV0FBcUIsQ0FBQztBQUM1QixhQUFXLFdBQVcsVUFBVSxNQUFNLEdBQUcsR0FBRztBQUMxQyxRQUFJLFlBQVksTUFBTSxZQUFZLElBQUs7QUFDdkMsUUFBSSxZQUFZLE1BQU07QUFDcEIsVUFBSSxTQUFTLFdBQVcsR0FBRztBQUN6QixjQUFNLElBQUk7QUFBQSxVQUNSLHNDQUFzQyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsUUFDN0Q7QUFBQSxNQUNGO0FBQ0EsZUFBUyxJQUFJO0FBQ2I7QUFBQSxJQUNGO0FBQ0EsYUFBUyxLQUFLLE9BQU87QUFBQSxFQUN2QjtBQUNBLFNBQU8sU0FBUyxXQUFXLElBQUksTUFBTSxJQUFJLFNBQVMsS0FBSyxHQUFHLENBQUM7QUFDN0Q7QUEyQk8sU0FBUyxXQUFXLE1BQXlCO0FBQ2xELFFBQU0sYUFBYSxtQkFBbUIsSUFBSTtBQUMxQyxNQUFJLGVBQWUsSUFBSyxRQUFPO0FBQy9CLFFBQU0sWUFBWSxXQUFXLFlBQVksR0FBRztBQUM1QyxTQUFPLGNBQWMsSUFBSSxNQUFNLFdBQVcsTUFBTSxHQUFHLFNBQVM7QUFDOUQ7QUFLTyxTQUFTLFNBQVMsTUFBc0I7QUFDN0MsUUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLE1BQUksZUFBZSxJQUFLLFFBQU87QUFDL0IsU0FBTyxXQUFXLE1BQU0sV0FBVyxZQUFZLEdBQUcsSUFBSSxDQUFDO0FBQ3pEOzs7QUMxRk8sU0FBUyxjQUFjLEdBQWlCLEdBQWtDO0FBQy9FLE1BQUksRUFBRSxZQUFZLEVBQUUsUUFBUyxRQUFPLEVBQUUsVUFBVSxFQUFFLFVBQVUsSUFBSTtBQUNoRSxNQUFJLEVBQUUsYUFBYSxFQUFFLFNBQVUsUUFBTyxFQUFFLFdBQVcsRUFBRSxXQUFXLElBQUk7QUFDcEUsU0FBTztBQUNUO0FBV08sU0FBUyxVQUNkLFFBQ0EsVUFDYztBQTlDaEI7QUErQ0UsU0FBTyxFQUFFLFdBQVUsc0NBQVEsWUFBUixZQUFtQixLQUFLLEdBQUcsU0FBUztBQUN6RDs7O0FDdkNBLGVBQXNCLFVBQVUsT0FBNkM7QUFDM0UsUUFBTSxPQUFPLE9BQU8sVUFBVSxXQUFXLElBQUksWUFBWSxFQUFFLE9BQU8sS0FBSyxJQUFJO0FBSzNFLFFBQU0sU0FBUyxNQUFNLE9BQU8sT0FBTyxPQUFPLFdBQVcsSUFBb0I7QUFDekUsU0FBTyxNQUFNLElBQUksV0FBVyxNQUFNLENBQUM7QUFDckM7QUF3Q0EsU0FBUyxNQUFNLE9BQTJCO0FBQ3hDLE1BQUksTUFBTTtBQUNWLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLFdBQU8sS0FBSyxTQUFTLEVBQUUsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLEVBQzFDO0FBQ0EsU0FBTztBQUNUOzs7QUNqRE8sSUFBZSxpQkFBZixjQUFzQyxNQUFNO0FBQUEsRUFHakQsWUFBWSxTQUFpQixTQUF3QjtBQUNuRCxVQUFNLFNBQVMsT0FBTztBQUN0QixTQUFLLE9BQU8sV0FBVztBQUFBLEVBQ3pCO0FBQ0Y7QUFRTyxJQUFNLG9CQUFOLGNBQWdDLGVBQWU7QUFBQSxFQUEvQztBQUFBO0FBQ0wsd0JBQVMsUUFBTztBQUFBO0FBQ2xCO0FBR08sSUFBTSxlQUFOLGNBQTJCLGVBQWU7QUFBQSxFQUExQztBQUFBO0FBQ0wsd0JBQVMsUUFBTztBQUFBO0FBQ2xCO0FBUU8sSUFBTSxnQkFBTixjQUE0QixlQUFlO0FBQUEsRUFBM0M7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjtBQUdPLElBQU0sZUFBTixjQUEyQixlQUFlO0FBQUEsRUFBMUM7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjs7O0FDOUJPLElBQU0sNkJBQTZCO0FBR25DLElBQU0seUJBQXlCO0FBdUQvQixTQUFTLFlBQVksT0FBbUIsUUFBc0M7QUFDbkYsTUFBSSxPQUFPLFdBQVcsT0FBTyxjQUFjLFFBQVc7QUFDcEQsVUFBTSxJQUFJO0FBQUEsTUFDUiw4QkFBOEIsS0FBSyxVQUFVLE9BQU8sSUFBSSxDQUFDO0FBQUEsSUFDM0Q7QUFBQSxFQUNGO0FBQ0EsUUFBTSxPQUF3QyxFQUFFLEdBQUcsTUFBTTtBQUN6RCxRQUFNLFFBQXlCO0FBQUEsSUFDN0IsTUFBTSxPQUFPO0FBQUEsSUFDYixNQUFNLE9BQU87QUFBQSxJQUNiLFdBQVcsT0FBTztBQUFBLElBQ2xCLE9BQU8sT0FBTztBQUFBLEVBQ2hCO0FBQ0EsTUFBSSxPQUFPLFFBQVMsT0FBTSxZQUFZLE9BQU87QUFDN0MsTUFBSSxPQUFPLFNBQVUsT0FBTSxXQUFXO0FBQ3RDLE9BQUssT0FBTyxJQUFJLElBQUk7QUFDcEIsU0FBTztBQUNUO0FBUU8sU0FBUyxZQUFZLE9BQW1CLE1BQTBCO0FBQ3ZFLE1BQUksRUFBRSxRQUFRLE9BQVEsUUFBTztBQUM3QixRQUFNLE9BQXdDLEVBQUUsR0FBRyxNQUFNO0FBQ3pELFNBQU8sS0FBSyxJQUFJO0FBQ2hCLFNBQU87QUFDVDtBQU9PLFNBQVMsb0JBQW9CLE9BQTJCO0FBQzdELFFBQU0sVUFBMkMsQ0FBQztBQUNsRCxhQUFXLFFBQVEsT0FBTyxLQUFLLEtBQUssRUFBRSxLQUFLLEdBQUc7QUFDNUMsWUFBUSxJQUFJLElBQUksTUFBTSxJQUFJO0FBQUEsRUFDNUI7QUFDQSxRQUFNLFdBQStCO0FBQUEsSUFDbkMsZUFBZTtBQUFBLElBQ2Y7QUFBQSxFQUNGO0FBQ0EsU0FBTyxLQUFLLFVBQVUsUUFBUTtBQUNoQztBQVFPLFNBQVMsc0JBQXNCLE1BQTBCO0FBQzlELE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxLQUFLLE1BQU0sSUFBSTtBQUFBLEVBQzFCLFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSSxjQUFjLHVDQUF1QyxFQUFFLE1BQU0sQ0FBQztBQUFBLEVBQzFFO0FBQ0EsTUFBSSxDQUFDLGNBQWMsTUFBTSxHQUFHO0FBQzFCLFVBQU0sSUFBSSxjQUFjLG9DQUFvQztBQUFBLEVBQzlEO0FBQ0EsUUFBTSxVQUFVLE9BQU87QUFDdkIsTUFBSSxPQUFPLFlBQVksWUFBWSxDQUFDLE9BQU8sVUFBVSxPQUFPLEdBQUc7QUFDN0QsVUFBTSxJQUFJLGNBQWMsb0RBQW9EO0FBQUEsRUFDOUU7QUFDQSxNQUFJLFlBQVksNEJBQTRCO0FBQzFDLFVBQU0sSUFBSTtBQUFBLE1BQ1IsOEJBQThCLE9BQU8sNkNBQ3RCLDBCQUEwQjtBQUFBLElBQzNDO0FBQUEsRUFDRjtBQUNBLFFBQU0sYUFBYSxPQUFPO0FBQzFCLE1BQUksQ0FBQyxjQUFjLFVBQVUsR0FBRztBQUM5QixVQUFNLElBQUksY0FBYyxpREFBaUQ7QUFBQSxFQUMzRTtBQUVBLFFBQU0sVUFBMkMsQ0FBQztBQUNsRCxhQUFXLENBQUMsTUFBTSxHQUFHLEtBQUssT0FBTyxRQUFRLFVBQVUsR0FBRztBQUNwRCxZQUFRLElBQUksSUFBSSxXQUFXLE1BQU0sR0FBRztBQUFBLEVBQ3RDO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxXQUFXLE1BQWMsS0FBK0I7QUFDL0QsUUFBTSxRQUFRLHFCQUFxQixLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQ3ZELE1BQUksQ0FBQyxjQUFjLEdBQUcsRUFBRyxPQUFNLElBQUksY0FBYyxHQUFHLEtBQUssbUJBQW1CO0FBQzVFLFFBQU0sRUFBRSxNQUFNLE1BQU0sV0FBVyxPQUFPLFdBQVcsU0FBUyxJQUFJO0FBQzlELE1BQUksT0FBTyxTQUFTLFNBQVUsT0FBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLHlCQUF5QjtBQUN2RixNQUFJLE9BQU8sY0FBYyxVQUFVO0FBQ2pDLFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyw4QkFBOEI7QUFBQSxFQUNoRTtBQUNBLE1BQUksT0FBTyxTQUFTLFlBQVksQ0FBQyxPQUFPLFVBQVUsSUFBSSxLQUFLLE9BQU8sR0FBRztBQUNuRSxVQUFNLElBQUksY0FBYyxHQUFHLEtBQUssdUNBQXVDO0FBQUEsRUFDekU7QUFDQSxNQUFJLENBQUMsY0FBYyxLQUFLLEtBQUssT0FBTyxNQUFNLFlBQVksWUFBWSxPQUFPLE1BQU0sYUFBYSxVQUFVO0FBQ3BHLFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyx1REFBdUQ7QUFBQSxFQUN6RjtBQUNBLE1BQUksY0FBYyxVQUFhLE9BQU8sY0FBYyxVQUFVO0FBQzVELFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSywyQ0FBMkM7QUFBQSxFQUM3RTtBQUNBLE1BQUksYUFBYSxVQUFhLE9BQU8sYUFBYSxXQUFXO0FBQzNELFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSywyQ0FBMkM7QUFBQSxFQUM3RTtBQUNBLFFBQU0sUUFBeUI7QUFBQSxJQUM3QjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQSxPQUFPLEVBQUUsU0FBUyxNQUFNLFNBQW1CLFVBQVUsTUFBTSxTQUFtQjtBQUFBLEVBQ2hGO0FBQ0EsTUFBSSxjQUFjLE9BQVcsT0FBTSxZQUFZO0FBQy9DLE1BQUksYUFBYSxPQUFXLE9BQU0sV0FBVztBQUM3QyxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGNBQWMsT0FBa0Q7QUFDdkUsU0FBTyxPQUFPLFVBQVUsWUFBWSxVQUFVLFFBQVEsQ0FBQyxNQUFNLFFBQVEsS0FBSztBQUM1RTs7O0FDbkpBLGVBQXNCLFVBQ3BCLFNBQ0EsT0FDQSxNQUNBLFdBQ0EsVUFBNEIsQ0FBQyxHQUNSO0FBMUR2QjtBQTJERSxRQUFNLE9BQU0sYUFBUSxRQUFSLFlBQWUsS0FBSyxJQUFJO0FBQ3BDLE1BQUksVUFBc0I7QUFFMUIsTUFBSTtBQUNGLGVBQVcsUUFBUSxLQUFLLE9BQU87QUFDN0IsZ0JBQVUsTUFBTSxhQUFhLFNBQVMsU0FBUyxNQUFNLFdBQVcsR0FBRztBQUFBLElBQ3JFO0FBQUEsRUFDRixTQUFTLE9BQU87QUFDZCxRQUFJO0FBQ0YsWUFBTSxhQUFhLFNBQVMsT0FBTztBQUFBLElBQ3JDLFNBQVE7QUFBQSxJQUdSO0FBQ0EsVUFBTTtBQUFBLEVBQ1I7QUFFQSxRQUFNLGFBQWEsU0FBUyxPQUFPO0FBQ25DLFNBQU87QUFDVDtBQUVBLGVBQWUsYUFDYixTQUNBLE9BQ0EsTUFDQSxXQUNBLEtBQ3FCO0FBQ3JCLE1BQUksS0FBSyxTQUFTLFVBQVU7QUFDMUIsUUFBSSxNQUFNLFFBQVEsT0FBTyxLQUFLLFFBQVEsR0FBRztBQUN2QyxZQUFNLFFBQVEsV0FBVyxLQUFLLFVBQVUsS0FBSyxNQUFNO0FBQUEsSUFDckQsT0FBTztBQUVMLFlBQU0sY0FBYyxTQUFTLEtBQUssUUFBUSxLQUFLLE1BQU0sU0FBUztBQUFBLElBQ2hFO0FBQ0EsV0FBTyxZQUFZLFlBQVksT0FBTyxLQUFLLFFBQVEsR0FBRztBQUFBLE1BQ3BELE1BQU0sS0FBSztBQUFBLE1BQ1gsV0FBVyxLQUFLO0FBQUEsTUFDaEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxNQUNYLE9BQU8sS0FBSztBQUFBLElBQ2QsQ0FBQztBQUFBLEVBQ0g7QUFFQSxNQUFJLEtBQUssVUFBVTtBQUlqQixRQUFJLENBQUMsS0FBSyxRQUFTLE9BQU0sUUFBUSxVQUFVLEtBQUssSUFBSTtBQUNwRCxXQUFPLFlBQVksT0FBTztBQUFBLE1BQ3hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsV0FBVyxLQUFLO0FBQUEsTUFDaEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxNQUNYLE9BQU8sS0FBSztBQUFBLE1BQ1osU0FBUyxLQUFLO0FBQUEsTUFDZCxXQUFXLEtBQUssVUFBVSxNQUFNO0FBQUEsTUFDaEMsVUFBVTtBQUFBLElBQ1osQ0FBQztBQUFBLEVBQ0g7QUFFQSxNQUFJLEtBQUssU0FBUztBQUdoQixVQUFNLFFBQVEsV0FBVyxLQUFLLElBQUk7QUFDbEMsV0FBTyxZQUFZLE9BQU87QUFBQSxNQUN4QixNQUFNLEtBQUs7QUFBQSxNQUNYLFdBQVcsS0FBSztBQUFBLE1BQ2hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsTUFBTSxLQUFLO0FBQUEsTUFDWCxPQUFPLEtBQUs7QUFBQSxNQUNaLFNBQVM7QUFBQSxNQUNULFdBQVc7QUFBQSxJQUNiLENBQUM7QUFBQSxFQUNIO0FBRUEsUUFBTSxVQUFVLE1BQU0sS0FBSyxJQUFJO0FBQy9CLE1BQ0UsWUFBWSxVQUNaLFFBQVEsY0FBYyxVQUN0QixRQUFRLFNBQVMsS0FBSyxRQUNyQixNQUFNLFFBQVEsT0FBTyxLQUFLLElBQUksR0FDL0I7QUFLQSxXQUFPLFlBQVksT0FBTztBQUFBLE1BQ3hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsV0FBVyxLQUFLO0FBQUEsTUFDaEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxNQUNYLE9BQU8sS0FBSztBQUFBLElBQ2QsQ0FBQztBQUFBLEVBQ0g7QUFFQSxRQUFNLGNBQWMsU0FBUyxLQUFLLE1BQU0sS0FBSyxNQUFNLFNBQVM7QUFDNUQsU0FBTyxZQUFZLE9BQU87QUFBQSxJQUN4QixNQUFNLEtBQUs7QUFBQSxJQUNYLFdBQVcsS0FBSztBQUFBLElBQ2hCLE1BQU0sS0FBSztBQUFBLElBQ1gsTUFBTSxLQUFLO0FBQUEsSUFDWCxPQUFPLEtBQUs7QUFBQSxFQUNkLENBQUM7QUFDSDtBQUdBLGVBQWUsY0FDYixTQUNBLE1BQ0EsTUFDQSxXQUNlO0FBQ2YsUUFBTSxRQUFRLE1BQU0sVUFBVSxJQUFJO0FBQ2xDLFFBQU0sU0FBUyxNQUFNLFVBQVUsS0FBSztBQUNwQyxNQUFJLFdBQVcsTUFBTTtBQUNuQixVQUFNLElBQUk7QUFBQSxNQUNSLDBCQUEwQixLQUFLLFVBQVUsSUFBSSxDQUFDLGNBQWMsSUFBSSxTQUFTLE1BQU07QUFBQSxJQUNqRjtBQUFBLEVBQ0Y7QUFDQSxRQUFNLFFBQVEsVUFBVSxNQUFNLEtBQUs7QUFDckM7QUFFQSxlQUFlLGFBQWEsU0FBeUIsT0FBa0M7QUFDckYsUUFBTSxRQUFRO0FBQUEsSUFDWjtBQUFBLElBQ0EsSUFBSSxZQUFZLEVBQUUsT0FBTyxvQkFBb0IsS0FBSyxDQUFDO0FBQUEsRUFDckQ7QUFDRjtBQU9BLGVBQXNCLGVBQWUsU0FBOEM7QUFDakYsUUFBTSxRQUFRLE1BQU0sUUFBUSxTQUFTLHNCQUFzQjtBQUMzRCxTQUFPLHNCQUFzQixJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssQ0FBQztBQUM5RDs7O0FDcExBLElBQU0sMEJBQStDLG9CQUFJLElBQUk7QUFBQSxFQUMzRDtBQUFBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFDRixDQUFDO0FBR0QsSUFBTSwwQkFBK0Msb0JBQUksSUFBSTtBQUFBLEVBQzNEO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFVTSxTQUFTLFVBQVUsV0FBbUIsVUFBbUM7QUFDOUUsUUFBTSxhQUFhLG1CQUFtQixTQUFTO0FBQy9DLE1BQUksZUFBZSxJQUFLLFFBQU87QUFFL0IsUUFBTSxRQUFRLFdBQVcsTUFBTSxDQUFDLEVBQUUsWUFBWTtBQUM5QyxRQUFNLFdBQVcsTUFBTSxNQUFNLEdBQUc7QUFFaEMsTUFBSSxTQUFTLEtBQUssQ0FBQyxZQUFZLHdCQUF3QixJQUFJLE9BQU8sQ0FBQyxHQUFHO0FBQ3BFLFdBQU87QUFBQSxFQUNUO0FBRUEsTUFBSSxTQUFTLENBQUMsTUFBTSxhQUFhO0FBQy9CLFFBQUksQ0FBQyxTQUFTLGFBQWMsUUFBTztBQUNuQyxRQUFJLHdCQUF3QixJQUFJLEtBQUssRUFBRyxRQUFPO0FBQy9DLFFBQUksU0FBUyxDQUFDLE1BQU0sUUFBUyxRQUFPO0FBQUEsRUFDdEM7QUFFQSxTQUFPO0FBQ1Q7OztBQzNDTyxJQUFNLGtCQUFrQjtBQUd4QixJQUFNLDJCQUEyQixNQUFNO0FBa085QyxJQUFNLGVBQW9DLG9CQUFJLElBQUk7QUFBQSxFQUNoRDtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQUNELElBQU0sZUFBb0Msb0JBQUksSUFBSTtBQUFBLEVBQ2hEO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQVFNLFNBQVMsVUFBVSxPQUFrQztBQUMxRCxTQUNFLE9BQU8sVUFBVSxZQUNqQixVQUFVLFFBQ1YsT0FBUSxNQUE2QixTQUFTLGFBQzdDLGFBQWEsSUFBSyxNQUEyQixJQUFJLEtBQ2hELGFBQWEsSUFBSyxNQUEyQixJQUFJO0FBRXZEO0FBc0JPLFNBQVMsYUFBYSxNQUF1QjtBQUNsRCxNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsS0FBSyxNQUFNLElBQUk7QUFBQSxFQUMxQixTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksY0FBYyw4QkFBOEIsT0FBTyxJQUFJLEVBQUUsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsRUFDL0Y7QUFDQSxNQUFJLENBQUMsVUFBVSxNQUFNLEdBQUc7QUFDdEIsVUFBTSxJQUFJO0FBQUEsTUFDUixzQ0FBc0MsS0FBSyxVQUFXLGlDQUErQixJQUFJLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFTTyxTQUFTLGNBQWMsT0FBMkI7QUFDdkQsTUFBSSxTQUFTO0FBQ2IsUUFBTSxRQUFRO0FBQ2QsV0FBUyxTQUFTLEdBQUcsU0FBUyxNQUFNLFFBQVEsVUFBVSxPQUFPO0FBQzNELGNBQVUsT0FBTyxhQUFhLEdBQUcsTUFBTSxTQUFTLFFBQVEsU0FBUyxLQUFLLENBQUM7QUFBQSxFQUN6RTtBQUNBLFNBQU8sS0FBSyxNQUFNO0FBQ3BCO0FBR08sU0FBUyxjQUFjLFNBQTZCO0FBQ3pELE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxLQUFLLE9BQU87QUFBQSxFQUN2QixTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksY0FBYywrQkFBK0IsRUFBRSxNQUFNLENBQUM7QUFBQSxFQUNsRTtBQUNBLFFBQU0sUUFBUSxJQUFJLFdBQVcsT0FBTyxNQUFNO0FBQzFDLFdBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxRQUFRLElBQUssT0FBTSxDQUFDLElBQUksT0FBTyxXQUFXLENBQUM7QUFDdEUsU0FBTztBQUNUOzs7QUM3VEEsSUFBTSx5QkFBeUI7QUFFL0IsSUFBTSxnQkFBZ0I7QUFHdEIsSUFBTSx5QkFBeUI7QUFHL0IsSUFBTSx1QkFBdUI7QUFHN0IsSUFBTSx1QkFBdUI7QUFRdEIsU0FBUyxtQkFBbUIsTUFBc0I7QUFDdkQsTUFBSSxVQUFVLEtBQUssUUFBUSx3QkFBd0IsRUFBRSxFQUFFLFFBQVEsZUFBZSxFQUFFO0FBQ2hGLFlBQVUsQ0FBQyxHQUFHLE9BQU8sRUFBRSxNQUFNLEdBQUcsc0JBQXNCLEVBQUUsS0FBSyxFQUFFO0FBQy9ELFlBQVUsUUFBUSxLQUFLLEVBQUUsUUFBUSxvQkFBb0IsRUFBRTtBQUN2RCxTQUFPLFFBQVEsV0FBVyxJQUFJLHVCQUF1QjtBQUN2RDtBQWVPLFNBQVMsaUJBQ2QsTUFDQSxZQUNBLEtBQ0EsU0FBNkMsTUFBTSxPQUMzQztBQUNSLFFBQU0sYUFBYSxtQkFBbUIsSUFBSTtBQUMxQyxRQUFNLE1BQU0sV0FBVyxVQUFVO0FBQ2pDLFFBQU0sT0FBTyxTQUFTLFVBQVU7QUFFaEMsUUFBTSxVQUFVLEtBQUssWUFBWSxHQUFHO0FBQ3BDLFFBQU0sZUFBZSxVQUFVO0FBQy9CLFFBQU0sT0FBTyxlQUFlLEtBQUssTUFBTSxHQUFHLE9BQU8sSUFBSTtBQUNyRCxRQUFNLFlBQVksZUFBZSxLQUFLLE1BQU0sT0FBTyxJQUFJO0FBRXZELFFBQU0sU0FBUyxjQUFjLG9CQUFvQixHQUFHLENBQUMsV0FBVyxtQkFBbUIsVUFBVSxDQUFDO0FBQzlGLFFBQU0sT0FBTyxDQUFDLGFBQThCLFFBQVEsTUFBTSxJQUFJLFFBQVEsS0FBSyxHQUFHLEdBQUcsSUFBSSxRQUFRO0FBRTdGLE1BQUksWUFBWSxLQUFLLEdBQUcsSUFBSSxHQUFHLE1BQU0sR0FBRyxTQUFTLEVBQUU7QUFDbkQsV0FBUyxJQUFJLEdBQUcsS0FBSyxzQkFBc0IsS0FBSztBQUM5QyxRQUFJLENBQUMsT0FBTyxTQUFTLEVBQUcsUUFBTztBQUMvQixnQkFBWSxLQUFLLEdBQUcsSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsU0FBUyxFQUFFO0FBQUEsRUFDdEQ7QUFDQSxRQUFNLElBQUk7QUFBQSxJQUNSLCtCQUErQixvQkFBb0IsbUJBQW1CLEtBQUssVUFBVSxVQUFVLENBQUM7QUFBQSxFQUNsRztBQUNGO0FBR0EsU0FBUyxvQkFBb0IsS0FBcUI7QUFDaEQsUUFBTSxJQUFJLElBQUksS0FBSyxHQUFHO0FBQ3RCLFFBQU0sTUFBTSxDQUFDLE1BQXNCLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQzVELFNBQ0UsR0FBRyxFQUFFLGVBQWUsQ0FBQyxJQUFJLElBQUksRUFBRSxZQUFZLElBQUksQ0FBQyxDQUFDLElBQUksSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDLElBQ3BFLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQyxJQUFJLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztBQUV0RDs7O0FDZ0VBLElBQU0sYUFBMkIsRUFBRSxTQUFTLEdBQUcsVUFBVSxHQUFHO0FBT3JELFNBQVMsZ0JBQWdCLE9BQWdDO0FBMUtoRTtBQTJLRSxRQUFNLEVBQUUsY0FBYyxPQUFPLGNBQWMsZ0JBQWdCLElBQUksSUFBSTtBQUNuRSxRQUFNLFdBQVcsQ0FBQyxHQUFHLE1BQU0sUUFBUSxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFDbEYsUUFBTSxpQkFBaUIsSUFBSSxJQUFJLFNBQVMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLE1BQU0sS0FBSyxDQUFDLENBQUM7QUFFM0UsUUFBTSxTQUFtQixDQUFDO0FBQzFCLFFBQU0sUUFBa0IsQ0FBQztBQUN6QixRQUFNLFlBQTBCLENBQUM7QUFHakMsUUFBTSxhQUFhLG9CQUFJLElBQVk7QUFDbkMsYUFBVyxLQUFLLGFBQWEsTUFBTyxZQUFXLElBQUksRUFBRSxJQUFJO0FBQ3pELGFBQVcsS0FBSyxhQUFhLFNBQVUsWUFBVyxJQUFJLEVBQUUsSUFBSTtBQUM1RCxhQUFXLEtBQUssYUFBYSxRQUFTLFlBQVcsSUFBSSxFQUFFLElBQUk7QUFDM0QsYUFBVyxLQUFLLGFBQWEsU0FBUztBQUNwQyxlQUFXLElBQUksRUFBRSxJQUFJO0FBQ3JCLGVBQVcsSUFBSSxFQUFFLEVBQUU7QUFBQSxFQUNyQjtBQUdBLFFBQU0sV0FBVyxvQkFBSSxJQUFZO0FBRWpDLFFBQU0sYUFBYSxDQUFDLFNBQTBCLFFBQVEsU0FBUyxlQUFlLElBQUksSUFBSTtBQU90RixhQUFXLFVBQVUsQ0FBQyxHQUFHLGFBQWEsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRztBQUM3RixVQUFNLFlBQVksTUFBTSxPQUFPLElBQUk7QUFDbkMsVUFBTSxVQUFVLE1BQU0sT0FBTyxFQUFFO0FBQy9CLFVBQU0sYUFBYSxlQUFlLElBQUksT0FBTyxJQUFJO0FBQ2pELFVBQU0sV0FBVyxlQUFlLElBQUksT0FBTyxFQUFFO0FBRTdDLFVBQU0sY0FBYyxhQUNoQixtQkFBbUIsV0FBVyxVQUFVLEtBQ3hDLHVDQUFXLGVBQWM7QUFDN0IsVUFBTSxZQUFZLFdBQ2QsbUJBQW1CLFNBQVMsUUFBUSxJQUNwQztBQUVKLFFBQUksQ0FBQyxlQUFlLENBQUMsV0FBVztBQUM5QixhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLFVBQVUsT0FBTztBQUFBLFFBQ2pCLFFBQVEsT0FBTztBQUFBLFFBQ2YsZ0JBQWUsNENBQVcsY0FBWCxZQUF3QjtBQUFBLFFBQ3ZDLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsTUFDZixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBR0EsUUFBSSxDQUFDLGFBQWE7QUFFaEIsVUFBSSxhQUFhLFVBQVUsY0FBYyxRQUFXO0FBQ2xELGVBQU8sS0FBSztBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ04sTUFBTSxPQUFPO0FBQUEsVUFDYixlQUFlLFVBQVU7QUFBQSxVQUN6QixNQUFNLFVBQVU7QUFBQSxVQUNoQixNQUFNLFVBQVU7QUFBQSxRQUNsQixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0YsV0FBVyxDQUFDLGNBQWMsV0FBVyxTQUFTO0FBRzVDLFlBQU07QUFBQSxRQUNKLFNBQVMsVUFBVSxPQUFPLE1BQU07QUFBQSxVQUM5QixPQUFNLG9EQUFZLFNBQVosWUFBb0IsdUNBQVcsU0FBL0IsWUFBdUMsT0FBTztBQUFBLFVBQ3BELE9BQU0sb0RBQVksU0FBWixZQUFvQix1Q0FBVyxTQUEvQixZQUF1QyxPQUFPO0FBQUEsVUFDcEQsVUFBUyw4Q0FBWSxZQUFaLFlBQXVCO0FBQUEsVUFDaEMsUUFBTyxvREFBWSxVQUFaLFlBQXFCLHVDQUFXLFVBQWhDLFlBQXlDO0FBQUEsVUFDaEQsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGLE9BQU87QUFJTCxZQUFNLGFBQWEsVUFBVSx1Q0FBVyxPQUFPLFlBQVk7QUFDM0QsVUFBSSxjQUFjLFdBQVcsT0FBTyxVQUFVLElBQUksR0FBRztBQUNuRCxjQUFNLEtBQUssU0FBUyxRQUFRLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDcEQsa0JBQVUsS0FBSztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsVUFDYixRQUFRO0FBQUEsVUFDUixRQUFRO0FBQUE7QUFBQSxVQUVSLGNBQWM7QUFBQSxVQUNkLFFBQVEsY0FBYyxVQUFVO0FBQUEsVUFDaEM7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNILE9BQU87QUFDTCxlQUFPLEtBQUs7QUFBQSxVQUNWLE1BQU07QUFBQSxVQUNOLFVBQVUsT0FBTztBQUFBLFVBQ2pCLFFBQVEsT0FBTztBQUFBLFVBQ2YsZ0JBQWUsNENBQVcsY0FBWCxZQUF3QjtBQUFBLFVBQ3ZDLE1BQU0sT0FBTztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDZixDQUFDO0FBQ0Qsa0JBQVUsS0FBSztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsVUFDYixRQUFRO0FBQUEsVUFDUixRQUFRO0FBQUEsVUFDUixjQUFjO0FBQUEsVUFDZCxRQUFRLGNBQWMsVUFBVTtBQUFBLFVBQ2hDO0FBQUEsUUFDRixDQUFDO0FBQ0Q7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFFBQUksQ0FBQyxXQUFXO0FBQ2QsYUFBTyxLQUFLO0FBQUEsUUFDVixPQUFNLG1DQUFTLGVBQWMsU0FBWSxZQUFZO0FBQUEsUUFDckQsTUFBTSxPQUFPO0FBQUEsUUFDYixnQkFBZSx3Q0FBUyxjQUFULFlBQXNCO0FBQUEsUUFDckMsTUFBTSxPQUFPO0FBQUEsUUFDYixNQUFNLE9BQU87QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNILE9BQU87QUFDTCwyQkFBcUIsT0FBTyxJQUFJLFNBQVMsVUFBd0I7QUFBQSxRQUMvRCxNQUFNLE9BQU87QUFBQSxRQUNiLE9BQU0sbUNBQVMsZUFBYyxTQUFZLFlBQVk7QUFBQSxRQUNyRCxNQUFNLE9BQU87QUFBQSxRQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBT0EsYUFBVyxRQUFRLE9BQU8sS0FBSyxLQUFLLEVBQ2pDLE9BQU8sQ0FBQyxNQUFNO0FBQ2IsVUFBTSxRQUFRLE1BQU0sQ0FBQztBQUNyQixXQUFPLE1BQU0sY0FBYyxVQUFhLENBQUMsTUFBTTtBQUFBLEVBQ2pELENBQUMsRUFDQSxLQUFLLGNBQWMsR0FBRztBQUN2QixRQUFJLFdBQVcsSUFBSSxJQUFJLEtBQUssU0FBUyxJQUFJLElBQUksRUFBRztBQUNoRCxRQUFJLGVBQWUsSUFBSSxJQUFJLEVBQUc7QUFDOUIsVUFBTSxRQUFRLE1BQU0sSUFBSTtBQUV4QixRQUFJO0FBQ0osUUFBSSxjQUFjO0FBQ2xCLGVBQVcsYUFBYSxVQUFVO0FBQ2hDLFVBQUksVUFBVSxRQUFTO0FBQ3ZCLFVBQUksV0FBVyxJQUFJLFVBQVUsSUFBSSxLQUFLLFNBQVMsSUFBSSxVQUFVLElBQUksRUFBRztBQUNwRSxZQUFNLFFBQVEsTUFBTSxVQUFVLElBQUk7QUFDbEMsVUFBSSxVQUFVLFVBQWEsTUFBTSxjQUFjLE9BQVc7QUFDMUQsVUFBSSxVQUFVLFNBQVMsTUFBTSxLQUFNO0FBQ25DLFlBQU0sVUFBVSxXQUFXLFVBQVUsSUFBSSxNQUFNLFdBQVcsSUFBSTtBQUM5RCxVQUFJLFNBQVMsUUFBVztBQUN0QixlQUFPO0FBQ1Asc0JBQWM7QUFBQSxNQUNoQixXQUFXLFdBQVcsQ0FBQyxhQUFhO0FBQ2xDLGVBQU87QUFDUCxzQkFBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUVBLFFBQUksTUFBTTtBQUNSLFlBQU0sS0FBSztBQUFBLFFBQ1QsTUFBTTtBQUFBLFFBQ04sVUFBVTtBQUFBLFFBQ1YsUUFBUSxLQUFLO0FBQUEsUUFDYixNQUFNLEtBQUs7QUFBQSxRQUNYLE1BQU0sS0FBSztBQUFBLFFBQ1gsU0FBUyxLQUFLO0FBQUEsUUFDZCxPQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFDRCxlQUFTLElBQUksSUFBSTtBQUNqQixlQUFTLElBQUksS0FBSyxJQUFJO0FBQUEsSUFDeEIsT0FBTztBQUtMLFlBQU07QUFBQSxRQUNKLFNBQVMsVUFBVSxNQUFNO0FBQUEsVUFDdkIsTUFBTSxNQUFNO0FBQUEsVUFDWixNQUFNLE1BQU07QUFBQSxVQUNaLFNBQVM7QUFBQSxVQUNULE9BQU8sTUFBTTtBQUFBLFVBQ2IsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFDQSxlQUFTLElBQUksSUFBSTtBQUFBLElBQ25CO0FBQUEsRUFDRjtBQUdBLGFBQVcsVUFBVSxVQUFVO0FBQzdCLFFBQUksV0FBVyxJQUFJLE9BQU8sSUFBSSxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksRUFBRztBQUM5RCxVQUFNLFFBQVEsTUFBTSxPQUFPLElBQUk7QUFDL0IsUUFBSSxDQUFDLG1CQUFtQixPQUFPLE1BQU0sRUFBRztBQUN4QyxRQUFJLFVBQVUsUUFBVztBQUN2QixVQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLGNBQU0sS0FBSyxTQUFTLE9BQU8sT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUMvQyxpQkFBUyxJQUFJLE9BQU8sSUFBSTtBQUFBLE1BQzFCO0FBRUE7QUFBQSxJQUNGO0FBQ0EsUUFBSSxPQUFPLFNBQVM7QUFDbEIsWUFBTSxLQUFLLFNBQVMsVUFBVSxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDcEQsV0FBVyxNQUFNLGNBQWMsUUFBVztBQUN4QyxZQUFNLEtBQUssU0FBUyxXQUFXLE9BQU8sTUFBTSxNQUFNLENBQUM7QUFBQSxJQUNyRCxPQUFPO0FBQ0wsWUFBTSxLQUFLLFNBQVMsUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDbEQ7QUFDQSxhQUFTLElBQUksT0FBTyxJQUFJO0FBQUEsRUFDMUI7QUFHQSxRQUFNLGFBQStCO0FBQUEsSUFDbkMsR0FBRyxhQUFhLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsTUFBTSxNQUFlLEVBQUU7QUFBQSxJQUNqRSxHQUFHLGFBQWEsU0FBUyxJQUFJLENBQUMsTUFBRztBQXpZckMsVUFBQUM7QUF5WXlDO0FBQUEsUUFDbkMsR0FBRztBQUFBLFFBQ0gsUUFBTUEsTUFBQSxNQUFNLEVBQUUsSUFBSSxNQUFaLGdCQUFBQSxJQUFlLGVBQWMsU0FBYSxZQUF1QjtBQUFBLE1BQ3pFO0FBQUEsS0FBRTtBQUFBLElBQ0YsR0FBRyxhQUFhLFFBQVEsSUFBSSxDQUFDLE9BQXVCLEVBQUUsR0FBRyxHQUFHLE1BQU0sU0FBUyxFQUFFO0FBQUEsRUFDL0UsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBRS9DLGFBQVcsYUFBYSxZQUFZO0FBQ2xDLFVBQU0sUUFBUSxNQUFNLFVBQVUsSUFBSTtBQUNsQyxVQUFNLFNBQVMsZUFBZSxJQUFJLFVBQVUsSUFBSTtBQUNoRCxVQUFNLG9CQUNKLFdBQVcsV0FBYyxVQUFVLFNBQVksT0FBTyxZQUFZLE1BQU0sWUFBWSxDQUFDLE9BQU87QUFDOUYsUUFBSSxDQUFDLG1CQUFtQjtBQUN0QixnQkFBVSxXQUFXLEtBQUs7QUFBQSxJQUM1QixPQUFPO0FBQ0wsMkJBQXFCLFVBQVUsTUFBTSxPQUFPLFFBQXNCLFNBQVM7QUFBQSxJQUM3RTtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQUEsSUFDTCxRQUFRLE9BQU8sS0FBSyxDQUFDLEdBQUcsTUFBTSxlQUFlLE9BQU8sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUM7QUFBQSxJQUNsRSxPQUFPLE1BQU0sS0FBSyxDQUFDLEdBQUcsTUFBTSxlQUFlLE9BQU8sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUM7QUFBQSxJQUNoRSxXQUFXLFVBQVUsS0FBSyxDQUFDLEdBQUcsTUFBTSxlQUFlLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQztBQUFBLElBQ2xFLGNBQWMsQ0FBQyxHQUFHLGFBQWEsWUFBWSxFQUFFLEtBQUssY0FBYztBQUFBLEVBQ2xFO0FBSUEsV0FBUyxVQUFVLFdBQTJCLE9BQTBDO0FBcmExRixRQUFBQSxLQUFBQyxLQUFBQyxLQUFBQztBQXNhSSxRQUFJLFVBQVUsU0FBUyxVQUFVO0FBQy9CLGFBQU8sS0FBSztBQUFBLFFBQ1YsTUFBTTtBQUFBLFFBQ04sTUFBTSxVQUFVO0FBQUEsUUFDaEIsZ0JBQWVILE1BQUEsK0JBQU8sY0FBUCxPQUFBQSxNQUFvQjtBQUFBLFFBQ25DLE9BQU1DLE1BQUEsK0JBQU8sU0FBUCxPQUFBQSxNQUFlLFVBQVU7QUFBQSxRQUMvQixPQUFNQyxNQUFBLCtCQUFPLFNBQVAsT0FBQUEsTUFBZSxVQUFVO0FBQUEsTUFDakMsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUNBLFdBQU8sS0FBSztBQUFBLE1BQ1YsTUFBTSxVQUFVO0FBQUEsTUFDaEIsTUFBTSxVQUFVO0FBQUEsTUFDaEIsZ0JBQWVDLE1BQUEsK0JBQU8sY0FBUCxPQUFBQSxNQUFvQjtBQUFBLE1BQ25DLE1BQU0sVUFBVTtBQUFBLE1BQ2hCLE1BQU0sVUFBVTtBQUFBLElBQ2xCLENBQUM7QUFBQSxFQUNIO0FBT0EsV0FBUyxxQkFDUCxNQUNBLE9BQ0EsUUFDQSxPQUNNO0FBbmNWLFFBQUFILEtBQUFDLEtBQUFDLEtBQUFDLEtBQUFDO0FBb2NJLFVBQU0sYUFBYSxVQUFVLCtCQUFPLE9BQU8sWUFBWTtBQUN2RCxVQUFNLGFBQWEsY0FBYyxPQUFPLE9BQU8sVUFBVSxJQUFJO0FBQzdELFVBQU0sVUFBVSxjQUFjLE1BQU07QUFDcEMsVUFBTSxTQUNKLE1BQU0sU0FBUyxZQUFZLE9BQU8sVUFDOUIsbUJBQ0EsVUFBVSxTQUNSLGVBQ0E7QUFFUixRQUFJLE1BQU0sU0FBUyxZQUFZLE9BQU8sU0FBUztBQUU3QyxZQUFNLEtBQUssU0FBUyxVQUFVLE1BQU0sTUFBTSxDQUFDO0FBQzNDO0FBQUEsSUFDRjtBQUVBLFFBQUksTUFBTSxTQUFTLFVBQVU7QUFFM0IsVUFBSSxZQUFZO0FBQ2QsY0FBTSxLQUFLLFNBQVMsUUFBUSxNQUFNLE1BQU0sQ0FBQztBQUN6QyxrQkFBVSxLQUFLO0FBQUEsVUFDYjtBQUFBLFVBQU07QUFBQSxVQUFRLFFBQVE7QUFBQSxVQUFVLGNBQWM7QUFBQSxVQUM5QyxRQUFRO0FBQUEsVUFBUztBQUFBLFFBQ25CLENBQUM7QUFBQSxNQUNILE9BQU87QUFDTCxlQUFPLEtBQUs7QUFBQSxVQUNWLE1BQU07QUFBQSxVQUNOO0FBQUEsVUFDQSxnQkFBZUosTUFBQSwrQkFBTyxjQUFQLE9BQUFBLE1BQW9CO0FBQUEsVUFDbkMsT0FBTUMsTUFBQSwrQkFBTyxTQUFQLE9BQUFBLE1BQWUsTUFBTTtBQUFBLFVBQzNCLE9BQU1DLE1BQUEsK0JBQU8sU0FBUCxPQUFBQSxNQUFlLE1BQU07QUFBQSxRQUM3QixDQUFDO0FBQ0Qsa0JBQVUsS0FBSztBQUFBLFVBQ2I7QUFBQSxVQUFNO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFBUyxjQUFjO0FBQUEsVUFDN0MsUUFBUTtBQUFBLFVBQVM7QUFBQSxRQUNuQixDQUFDO0FBQUEsTUFDSDtBQUNBO0FBQUEsSUFDRjtBQUVBLFFBQUksT0FBTyxTQUFTO0FBRWxCLFVBQUksWUFBWTtBQUNkLGNBQU0sS0FBSyxTQUFTLFVBQVUsTUFBTSxNQUFNLENBQUM7QUFDM0Msa0JBQVUsS0FBSztBQUFBLFVBQ2I7QUFBQSxVQUFNO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFBVSxjQUFjO0FBQUEsVUFDOUMsa0JBQWtCLGlCQUFpQixNQUFNLE9BQU8sTUFBTTtBQUFBLFVBQ3RELFFBQVE7QUFBQSxVQUFTO0FBQUEsUUFDbkIsQ0FBQztBQUFBLE1BQ0gsT0FBTztBQUNMLGVBQU8sS0FBSztBQUFBLFVBQ1YsTUFBTSxNQUFNO0FBQUEsVUFDWjtBQUFBLFVBQ0EsZ0JBQWVDLE1BQUEsK0JBQU8sY0FBUCxPQUFBQSxNQUFvQjtBQUFBLFVBQ25DLE1BQU0sTUFBTTtBQUFBLFVBQ1osTUFBTSxNQUFNO0FBQUEsUUFDZCxDQUFDO0FBQ0Qsa0JBQVUsS0FBSztBQUFBLFVBQ2I7QUFBQSxVQUFNO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFBUyxjQUFjO0FBQUEsVUFDN0MsUUFBUTtBQUFBLFVBQVM7QUFBQSxRQUNuQixDQUFDO0FBQUEsTUFDSDtBQUNBO0FBQUEsSUFDRjtBQUdBLFFBQUksWUFBWTtBQUNkLFlBQU07QUFBQSxRQUNKLFVBQVMsK0JBQU8sZUFBYyxTQUFZLFlBQVksVUFBVSxTQUFZLFFBQVEsUUFBUSxNQUFNLE1BQU07QUFBQSxNQUMxRztBQUNBLGdCQUFVLEtBQUs7QUFBQSxRQUNiO0FBQUEsUUFBTTtBQUFBLFFBQVEsUUFBUTtBQUFBLFFBQVUsY0FBYztBQUFBLFFBQzlDLGtCQUFrQixpQkFBaUIsTUFBTSxPQUFPLE1BQU07QUFBQSxRQUN0RCxRQUFRO0FBQUEsUUFBUztBQUFBLE1BQ25CLENBQUM7QUFBQSxJQUNILE9BQU87QUFDTCxhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU0sTUFBTTtBQUFBLFFBQ1o7QUFBQTtBQUFBO0FBQUEsUUFHQSxnQkFBZUMsTUFBQSwrQkFBTyxjQUFQLE9BQUFBLE1BQW9CO0FBQUEsUUFDbkMsTUFBTSxNQUFNO0FBQUEsUUFDWixNQUFNLE1BQU07QUFBQSxNQUNkLENBQUM7QUFDRCxnQkFBVSxLQUFLO0FBQUEsUUFDYjtBQUFBLFFBQU07QUFBQSxRQUFRLFFBQVE7QUFBQSxRQUFTLGNBQWM7QUFBQSxRQUM3QyxRQUFRO0FBQUEsUUFBUztBQUFBLE1BQ25CLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQVFBLFdBQVMsaUJBQWlCLE1BQWMsT0FBdUIsUUFBd0M7QUFDckcsUUFBSSxNQUFNLFNBQVMsT0FBTyxLQUFNLFFBQU87QUFDdkMsVUFBTSxXQUFXLGlCQUFpQixNQUFNLGdCQUFnQixLQUFLLFVBQVU7QUFDdkUsV0FBTyxLQUFLO0FBQUEsTUFDVixNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUE7QUFBQSxNQUVOLGVBQWUsT0FBTztBQUFBLE1BQ3RCLE1BQU0sTUFBTTtBQUFBLE1BQ1osTUFBTSxNQUFNO0FBQUEsSUFDZCxDQUFDO0FBQ0QsV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUlBLFNBQVMsU0FDUCxNQUNBLE1BQ0EsUUFHWTtBQTdqQmQ7QUE4akJFLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQTtBQUFBLElBQ0EsTUFBTSxPQUFPO0FBQUEsSUFDYixNQUFNLE9BQU87QUFBQSxJQUNiLFNBQVMsT0FBTztBQUFBLElBQ2hCLE9BQU8sT0FBTztBQUFBLElBQ2QsVUFBUyxZQUFPLFlBQVAsWUFBa0IsU0FBUztBQUFBLElBQ3BDLEdBQUksT0FBTyxXQUFXLEVBQUUsVUFBVSxLQUFLLElBQUksQ0FBQztBQUFBLEVBQzlDO0FBQ0Y7QUFFQSxTQUFTLGNBQWMsUUFBMEM7QUFDL0QsU0FBTztBQUFBLElBQ0wsU0FBUyxPQUFPO0FBQUEsSUFDaEIsTUFBTSxPQUFPO0FBQUEsSUFDYixNQUFNLE9BQU87QUFBQSxJQUNiLFNBQVMsT0FBTztBQUFBLElBQ2hCLE9BQU8sT0FBTztBQUFBLEVBQ2hCO0FBQ0Y7QUFRQSxTQUFTLG1CQUNQLE9BQ0EsUUFDUztBQUNULE1BQUksV0FBVyxPQUFXLFFBQU87QUFDakMsTUFBSSxVQUFVLE9BQVcsUUFBTyxDQUFDLE9BQU87QUFDeEMsU0FBTyxPQUFPLFlBQVksTUFBTTtBQUNsQztBQUVBLFNBQVMsT0FBTyxJQUE2QjtBQUMzQyxTQUFPLEdBQUcsU0FBUyxXQUFXLEdBQUcsU0FBUyxHQUFHO0FBQy9DO0FBRUEsU0FBUyxlQUFlLEdBQVcsR0FBbUI7QUFDcEQsU0FBTyxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSTtBQUNsQzs7O0FDM2hCQSxlQUFzQixVQUNwQixTQUNBLE9BQ0EsVUFDQSxLQUN1QjtBQUN2QixRQUFNLFFBQVEsTUFBTSxRQUFRLFVBQVU7QUFFdEMsUUFBTSxPQUFtQixDQUFDO0FBQzFCLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLFFBQUksQ0FBQyxVQUFVLEtBQUssTUFBTSxRQUFRLEVBQUcsTUFBSyxLQUFLLElBQUk7QUFBQSxFQUNyRDtBQUNBLFFBQU0sWUFBWSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQztBQUVqRCxRQUFNLFFBQXlCLENBQUM7QUFDaEMsUUFBTSxXQUE0QixDQUFDO0FBRW5DLGFBQVcsUUFBUSxNQUFNO0FBQ3ZCLFVBQU0sUUFBUSxNQUFNLEtBQUssSUFBSTtBQUM3QixVQUFNLE9BQU8sTUFBTSxVQUFVLE1BQU0sUUFBUSxTQUFTLEtBQUssSUFBSSxDQUFDO0FBQzlELFFBQUksVUFBVSxRQUFXO0FBQ3ZCLFlBQU0sS0FBSyxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssQ0FBQztBQUNyRDtBQUFBLElBQ0Y7QUFDQSxRQUFJLE1BQU0sVUFBVTtBQUVsQixlQUFTLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFDeEQ7QUFBQSxJQUNGO0FBR0EsUUFBSSxNQUFNLGNBQWMsVUFBYSxNQUFNLFNBQVMsTUFBTTtBQUN4RCxlQUFTLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFBQSxJQUMxRDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFVBQThCLENBQUM7QUFDckMsYUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDakQsUUFBSSxNQUFNLFNBQVU7QUFDcEIsUUFBSSxNQUFNLGNBQWMsT0FBVztBQUNuQyxRQUFJLFVBQVUsSUFBSSxJQUFJLEVBQUc7QUFDekIsUUFBSSxVQUFVLE1BQU0sUUFBUSxHQUFHO0FBRTdCO0FBQUEsSUFDRjtBQUNBLFlBQVEsS0FBSyxFQUFFLE1BQU0sTUFBTSxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sV0FBVyxNQUFNLFVBQVUsQ0FBQztBQUFBLEVBQ3ZGO0FBRUEsUUFBTSxFQUFFLFNBQVMsU0FBUyxrQkFBa0IsT0FBTyxlQUFlLElBQUksY0FBYyxTQUFTLEtBQUs7QUFDbEcsUUFBTSxlQUFlLE1BQU0sbUJBQW1CLFNBQVMsT0FBTyxVQUFVLEtBQUs7QUFFN0UsU0FBTztBQUFBLElBQ0wsV0FBVztBQUFBLElBQ1gsT0FBTyxlQUFlLGNBQWM7QUFBQSxJQUNwQyxVQUFVLGVBQWUsUUFBUTtBQUFBLElBQ2pDLFNBQVMsQ0FBQyxHQUFHLGdCQUFnQixFQUFFLEtBQUssTUFBTTtBQUFBLElBQzFDLFNBQVMsQ0FBQyxHQUFHLE9BQU8sRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLE9BQU8sR0FBRyxDQUFDLENBQUM7QUFBQSxJQUNqRDtBQUFBLEVBQ0Y7QUFDRjtBQVVBLFNBQVMsY0FDUCxTQUNBLE9BS0E7QUExSkY7QUEySkUsUUFBTSxhQUFhLG9CQUFJLElBQTZCO0FBQ3BELGFBQVcsYUFBYSxDQUFDLEdBQUcsS0FBSyxFQUFFLEtBQUssTUFBTSxHQUFHO0FBQy9DLFVBQU0sU0FBUyxXQUFXLElBQUksVUFBVSxJQUFJO0FBQzVDLFFBQUksT0FBUSxRQUFPLEtBQUssU0FBUztBQUFBLFFBQzVCLFlBQVcsSUFBSSxVQUFVLE1BQU0sQ0FBQyxTQUFTLENBQUM7QUFBQSxFQUNqRDtBQUVBLFFBQU0sV0FBVyxvQkFBSSxJQUFZO0FBQ2pDLFFBQU0sVUFBNkIsQ0FBQztBQUNwQyxRQUFNLG1CQUF1QyxDQUFDO0FBRTlDLGFBQVcsWUFBWSxDQUFDLEdBQUcsT0FBTyxFQUFFLEtBQUssTUFBTSxHQUFHO0FBQ2hELFVBQU0sY0FBYSxnQkFBVyxJQUFJLFNBQVMsSUFBSSxNQUE1QixZQUFpQyxDQUFDO0FBQ3JELFFBQUk7QUFDSixRQUFJO0FBQ0osZUFBVyxhQUFhLFlBQVk7QUFDbEMsVUFBSSxTQUFTLElBQUksVUFBVSxJQUFJLEVBQUc7QUFDbEMsVUFBSSxXQUFXLFVBQVUsSUFBSSxNQUFNLFdBQVcsU0FBUyxJQUFJLEdBQUc7QUFDNUQsOENBQVk7QUFBQSxNQUNkLE9BQU87QUFDTCxpREFBYTtBQUFBLE1BQ2Y7QUFBQSxJQUNGO0FBQ0EsVUFBTSxRQUFRLDRCQUFXO0FBQ3pCLFFBQUksT0FBTztBQUNULGVBQVMsSUFBSSxNQUFNLElBQUk7QUFDdkIsY0FBUSxLQUFLLEVBQUUsTUFBTSxTQUFTLE1BQU0sSUFBSSxNQUFNLE1BQU0sTUFBTSxTQUFTLE1BQU0sTUFBTSxTQUFTLEtBQUssQ0FBQztBQUFBLElBQ2hHLE9BQU87QUFDTCx1QkFBaUIsS0FBSyxRQUFRO0FBQUEsSUFDaEM7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLFNBQVM7QUFBQSxJQUNULE9BQU8sTUFBTSxPQUFPLENBQUMsY0FBYyxDQUFDLFNBQVMsSUFBSSxVQUFVLElBQUksQ0FBQztBQUFBLEVBQ2xFO0FBQ0Y7QUFRQSxlQUFlLG1CQUNiLFNBQ0EsT0FDQSxVQUNBLE9BQ21CO0FBQ25CLFFBQU0sa0JBQWtCLG9CQUFJLElBQVk7QUFDeEMsYUFBVyxRQUFRLE9BQU87QUFDeEIsYUFBUyxNQUFNLFdBQVcsS0FBSyxJQUFJLEdBQUcsUUFBUSxLQUFLLE1BQU0sV0FBVyxHQUFHLEdBQUc7QUFDeEUsc0JBQWdCLElBQUksR0FBRztBQUFBLElBQ3pCO0FBQUEsRUFDRjtBQUVBLFFBQU0sZUFBeUIsQ0FBQztBQUNoQyxhQUFXLE9BQU8sTUFBTSxRQUFRLFNBQVMsR0FBRztBQUMxQyxRQUFJLFFBQVEsSUFBSztBQUNqQixRQUFJLGdCQUFnQixJQUFJLEdBQUcsRUFBRztBQUM5QixRQUFJLFVBQVUsS0FBSyxRQUFRLEVBQUc7QUFDOUIsVUFBTSxRQUFRLE1BQU0sR0FBRztBQUN2QixTQUFJLCtCQUFPLGFBQVksTUFBTSxjQUFjLE9BQVc7QUFDdEQsaUJBQWEsS0FBSyxHQUFHO0FBQUEsRUFDdkI7QUFDQSxTQUFPLGFBQWEsS0FBSztBQUMzQjtBQUVBLFNBQVMsZUFBZSxZQUE4QztBQUNwRSxTQUFPLENBQUMsR0FBRyxVQUFVLEVBQUUsS0FBSyxNQUFNO0FBQ3BDO0FBRUEsU0FBUyxPQUFtRCxHQUFNLEdBQWM7QUFyT2hGO0FBc09FLFFBQU0sUUFBTyxhQUFFLFNBQUYsWUFBVSxFQUFFLFNBQVosWUFBb0I7QUFDakMsUUFBTSxRQUFPLGFBQUUsU0FBRixZQUFVLEVBQUUsU0FBWixZQUFvQjtBQUNqQyxTQUFPLE9BQU8sT0FBTyxLQUFLLE9BQU8sT0FBTyxJQUFJO0FBQzlDOzs7QUMvSEEsSUFBTSxhQUF5QjtBQUFBLEVBQzdCLE9BQU8sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNkLE1BQU0sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNiLE1BQU0sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNiLE9BQU8sTUFBTTtBQUFBLEVBQUM7QUFDaEI7QUFFQSxJQUFNLGtCQUFrQixDQUFDLElBQWdCLE9BQTZCO0FBQ3BFLFFBQU0sU0FBUyxXQUFXLFdBQVcsSUFBSSxFQUFFO0FBQzNDLFNBQU8sTUFBTSxXQUFXLGFBQWEsTUFBTTtBQUM3QztBQWdCTyxJQUFNLGFBQU4sTUFBaUI7QUFBQSxFQWdDdEIsWUFBWSxTQUE0QjtBQS9CeEMsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFFakIsd0JBQVEsYUFBOEI7QUFDdEMsd0JBQVEsU0FBeUI7QUFDakMsd0JBQVEsU0FBb0IsQ0FBQztBQUM3Qix3QkFBUSxVQUFTO0FBQ2pCLHdCQUFRLGNBQTRCO0FBQ3BDLHdCQUFRLFdBQVU7QUFDbEIsd0JBQVEsYUFBMEIsQ0FBQztBQUNuQyx3QkFBUTtBQUNSLHdCQUFRLGdCQUFvQztBQUM1Qyx3QkFBUSxrQkFBc0M7QUFHOUM7QUFBQSx3QkFBUSxRQUF5QixRQUFRLFFBQVE7QUFDakQsd0JBQVEsYUFBWTtBQUVwQjtBQUFBLHdCQUFRLGFBQVk7QUFDcEIsd0JBQVEsWUFBc0IsQ0FBQztBQUUvQjtBQUFBLHdCQUFRLGVBSUc7QUFzSlg7QUFBQSx3QkFBUSxzQkFBcUIsQ0FBQyxZQUEyQjtBQUN2RCxZQUFNLGNBQWMsS0FBSztBQUN6QixVQUFJLGdCQUFnQixRQUFRLFlBQVksUUFBUSxPQUFPLEdBQUc7QUFDeEQsYUFBSyxjQUFjO0FBQ25CLG9CQUFZLFFBQVEsT0FBTztBQUMzQjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLEtBQUssV0FBVztBQUNsQixhQUFLLFNBQVMsS0FBSyxPQUFPO0FBQzFCO0FBQUEsTUFDRjtBQUNBLFdBQUssUUFBUSxZQUFZO0FBQ3ZCLGNBQU0sS0FBSyxTQUFTLE9BQU87QUFBQSxNQUM3QixDQUFDLEVBQUUsTUFBTSxDQUFDLFVBQW1CLEtBQUssSUFBSSxLQUFLLHlCQUF5QixLQUFLLENBQUM7QUFBQSxJQUM1RTtBQTJhQSx3QkFBaUIsYUFBdUIsT0FBTyxTQUFzQztBQUNuRixVQUFJLFNBQVMsR0FBSSxPQUFNLElBQUksY0FBYyw2Q0FBNkM7QUFDdEYsWUFBTSxTQUFTLE1BQU0sS0FBSyxRQUFRLFVBQVUsSUFBSSxJQUFJO0FBQ3BELFVBQUksV0FBVyxPQUFXLFFBQU87QUFDakMsWUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhLElBQUk7QUFDMUMsWUFBTSxLQUFLLFFBQVEsVUFBVSxJQUFJLE1BQU0sS0FBSztBQUM1QyxhQUFPO0FBQUEsSUFDVDtBQXh2QkY7QUFxS0ksU0FBSyxVQUFVO0FBQ2YsU0FBSyxPQUFNLGFBQVEsUUFBUixZQUFlO0FBQzFCLFNBQUssT0FBTSxhQUFRLFFBQVIsYUFBZ0IsTUFBTSxLQUFLLElBQUk7QUFDMUMsU0FBSyxjQUFhLGFBQVEsZUFBUixZQUFzQjtBQUN4QyxTQUFLLFlBQVcsYUFBUSxhQUFSLFlBQW9CO0FBQ3BDLFNBQUssZ0JBQ0gsT0FBTyxRQUFRLGNBQWMsYUFDekIsUUFBUSxZQUNSLE1BQU0sUUFBUTtBQUNwQixTQUFLLGtCQUFpQixhQUFRLGFBQVIsWUFBb0IsRUFBRSxjQUFjLE1BQU07QUFBQSxFQUNsRTtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQU0sVUFBeUI7QUFDN0IsVUFBTSxLQUFLLFFBQVEsTUFBTSxLQUFLLFFBQVEsQ0FBQztBQUFBLEVBQ3pDO0FBQUE7QUFBQSxFQUdBLE1BQU0sWUFBMkI7QUFDL0IsVUFBTSxLQUFLLFFBQVEsWUFBWTtBQTFMbkM7QUEyTE0saUJBQUssY0FBTCxtQkFBZ0I7QUFDaEIsV0FBSyxZQUFZO0FBQ2pCLFlBQU0sS0FBSyxRQUFRO0FBQUEsSUFDckIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLFFBQWM7QUFqTWhCO0FBa01JLFNBQUssYUFBYTtBQUNsQixlQUFLLG1CQUFMO0FBQ0EsU0FBSyxpQkFBaUI7QUFDdEIsZUFBSyxjQUFMLG1CQUFnQjtBQUNoQixTQUFLLFlBQVk7QUFDakIsU0FBSyxRQUFRO0FBQUEsRUFDZjtBQUFBO0FBQUEsRUFHQSxjQUFjLGNBQWtDO0FBQzlDLFNBQUssYUFBYTtBQUNsQixTQUFLLGVBQWU7QUFDcEIsaUJBQWEsTUFBTSxDQUFDLFdBQVcsS0FBSyxjQUFjLE1BQU0sQ0FBQztBQUFBLEVBQzNEO0FBQUEsRUFFQSxlQUFxQjtBQWpOdkI7QUFrTkksZUFBSyxpQkFBTCxtQkFBbUI7QUFDbkIsU0FBSyxlQUFlO0FBQUEsRUFDdEI7QUFBQTtBQUFBLEVBR0EsTUFBTSxjQUE2QjtBQUNqQyxVQUFNLEtBQUssUUFBUSxNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUEsRUFDMUM7QUFBQTtBQUFBLEVBR0EsTUFBTSxXQUEwQjtBQUM5QixXQUFPLEtBQUssWUFBWSxFQUFHLE9BQU0sS0FBSztBQUN0QyxVQUFNLEtBQUs7QUFBQSxFQUNiO0FBQUEsRUFFQSxTQUEyQjtBQUN6QixXQUFPO0FBQUEsTUFDTCxPQUFPLEtBQUs7QUFBQSxNQUNaLFlBQVksS0FBSztBQUFBLE1BQ2pCLFNBQVMsS0FBSztBQUFBLE1BQ2QsV0FBVyxDQUFDLEdBQUcsS0FBSyxTQUFTO0FBQUEsSUFDL0I7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLGVBQTJCO0FBQ3pCLFdBQU8sRUFBRSxHQUFHLEtBQUssTUFBTTtBQUFBLEVBQ3pCO0FBQUE7QUFBQSxFQUdBLElBQUksY0FBc0I7QUFDeEIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBO0FBQUEsRUFHUSxpQkFBMEI7QUFDaEMsV0FBTyxLQUFLLFVBQVU7QUFBQSxFQUN4QjtBQUFBO0FBQUEsRUFJQSxNQUFjLFVBQXlCO0FBQ3JDLFNBQUssUUFBUTtBQUNiLFNBQUssWUFBWTtBQUNqQixTQUFLLFdBQVcsQ0FBQztBQUVqQixTQUFLLFFBQVMsTUFBTSxLQUFLLGtCQUFrQixzQkFBc0IsSUFDN0QsTUFBTSxlQUFlLEtBQUssUUFBUSxPQUFPLElBQ3pDLENBQUM7QUFFTCxVQUFNLFlBQVksS0FBSyxjQUFjO0FBQ3JDLFNBQUssWUFBWTtBQUNqQixjQUFVLFVBQVUsQ0FBQyxZQUFZLEtBQUssbUJBQW1CLE9BQU8sQ0FBQztBQUNqRSxjQUFVLFFBQVEsQ0FBQyxXQUFXLEtBQUssaUJBQWlCLE1BQU0sQ0FBQztBQUUzRCxVQUFNLFdBQVcsTUFBTSxLQUFLO0FBQUEsTUFDMUIsQ0FBQyxNQUFNLEVBQUUsU0FBUyxjQUFjLEVBQUUsU0FBUztBQUFBLE1BQzNDLE1BQ0UsVUFBVSxLQUFLO0FBQUEsUUFDYixNQUFNO0FBQUEsUUFDTixPQUFPLEtBQUssUUFBUTtBQUFBLFFBQ3BCLGlCQUFpQjtBQUFBLFFBQ2pCLFFBQVEsS0FBSztBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0w7QUFDQSxRQUFJLFNBQVMsU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLFFBQVE7QUFDMUQsU0FBSyxpQkFBaUIsRUFBRSxjQUFjLFNBQVMsU0FBUyxhQUFhO0FBRXJFLFNBQUssUUFBUTtBQUNiLFVBQU0sS0FBSyxTQUFTO0FBRXBCLFNBQUssWUFBWTtBQUNqQixVQUFNLFdBQVcsS0FBSztBQUN0QixTQUFLLFdBQVcsQ0FBQztBQUNqQixlQUFXLFdBQVcsVUFBVTtBQUM5QixZQUFNLEtBQUssU0FBUyxPQUFPO0FBQUEsSUFDN0I7QUFDQSxRQUFJLENBQUMsS0FBSyxlQUFlLEVBQUcsTUFBSyxRQUFRO0FBQUEsRUFDM0M7QUFBQSxFQUVBLE1BQWMsa0JBQWtCLE1BQWdDO0FBQzlELFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxRQUFRLFFBQVEsT0FBTyxJQUFJO0FBQUEsSUFDL0MsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRVEsaUJBQWlCLFFBQWtEO0FBMVM3RTtBQTJTSSxTQUFLLElBQUksS0FBSyxvQkFBb0IsTUFBTTtBQUN4QyxTQUFLLFFBQVE7QUFDYixVQUFNLGNBQWMsS0FBSztBQUN6QixRQUFJLGdCQUFnQixNQUFNO0FBQ3hCLFdBQUssY0FBYztBQUNuQixrQkFBWTtBQUFBLFFBQ1YsSUFBSSxhQUFhLHVCQUFzQixrQkFBTyxXQUFQLFlBQWlCLE9BQU8sU0FBeEIsWUFBZ0MsU0FBUyxFQUFFO0FBQUEsTUFDcEY7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBb0JBLE1BQWMsU0FBUyxTQUFpQztBQUN0RCxZQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3BCLEtBQUs7QUFDSCxjQUFNLEtBQUssYUFBYSxPQUFPO0FBQy9CO0FBQUEsTUFDRixLQUFLO0FBQ0g7QUFBQTtBQUFBLE1BQ0YsS0FBSztBQUNIO0FBQUEsTUFDRixLQUFLO0FBQ0gsYUFBSyxJQUFJLE1BQU0sZ0JBQWdCLFFBQVEsTUFBTSxRQUFRLE9BQU87QUFDNUQ7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFHSCxhQUFLLElBQUksS0FBSywyQkFBMkIsUUFBUSxJQUFJO0FBQ3JEO0FBQUEsTUFDRjtBQUNFLGFBQUssSUFBSSxLQUFLLGlEQUFpRCxPQUFPO0FBQUEsSUFDMUU7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGFBQWEsUUFBc0M7QUFDL0QsUUFBSSxPQUFPLE1BQU0sS0FBSyxPQUFRLE1BQUssU0FBUyxPQUFPO0FBQ25ELFFBQUksVUFBVSxPQUFPLE1BQU0sS0FBSyxjQUFjLEVBQUc7QUFDakQsUUFBSSxPQUFPLGFBQWEsVUFBYSxVQUFVLE9BQU8sVUFBVSxLQUFLLGNBQWMsRUFBRztBQUl0RixVQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxRQUFJLFVBQVUsUUFBVztBQUN2QixVQUFJLE1BQU0sY0FBYyxPQUFPLFFBQVM7QUFDeEMsVUFBSSxjQUFjLE1BQU0sT0FBTyxPQUFPLEtBQUssS0FBSyxFQUFHO0FBQUEsSUFDckQ7QUFHQSxRQUFJLENBQUUsTUFBTSxLQUFLLGFBQWEsTUFBTSxHQUFJO0FBQ3RDLFdBQUssSUFBSSxLQUFLLGlEQUFpRCxPQUFPLElBQUk7QUFDMUUsV0FBSyxrQkFBa0I7QUFDdkI7QUFBQSxJQUNGO0FBRUEsU0FBSyxRQUFRLE1BQU0sS0FBSyxXQUFXLENBQUMsS0FBSyxpQkFBaUIsTUFBTSxDQUFDLENBQUM7QUFBQSxFQUNwRTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLE1BQWMsYUFBYSxRQUF5QztBQUNsRSxRQUFJLE9BQU8sYUFBYSxLQUFNLFFBQU87QUFDckMsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUM3RCxVQUFJLE1BQU0sS0FBSyx1QkFBdUIsT0FBTyxRQUFRLEVBQUcsUUFBTztBQUMvRCxVQUFJLE1BQU0sS0FBSyxjQUFjLE9BQU8sSUFBSSxHQUFHO0FBQ3pDLGNBQU0sUUFBUSxLQUFLLE1BQU0sT0FBTyxJQUFJO0FBQ3BDLFlBQUksVUFBVSxVQUFhLE1BQU0sY0FBYyxPQUFXLFFBQU87QUFDakUsY0FBTSxTQUFTLE1BQU0sVUFBVSxNQUFNLEtBQUssUUFBUSxRQUFRLFNBQVMsT0FBTyxJQUFJLENBQUM7QUFDL0UsWUFBSSxXQUFXLE1BQU0sS0FBTSxRQUFPO0FBQUEsTUFDcEM7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUNBLFdBQU8sQ0FBRSxNQUFNLEtBQUssdUJBQXVCLE9BQU8sSUFBSTtBQUFBLEVBQ3hEO0FBQUEsRUFFQSxNQUFjLHVCQUF1QixNQUFnQztBQUNuRSxVQUFNLFFBQVEsS0FBSyxNQUFNLElBQUk7QUFDN0IsUUFBSSwrQkFBTyxTQUFVLFFBQU87QUFDNUIsUUFBSSxDQUFFLE1BQU0sS0FBSyxjQUFjLElBQUksRUFBSSxRQUFPO0FBQzlDLFFBQUksVUFBVSxVQUFhLE1BQU0sY0FBYyxPQUFXLFFBQU87QUFDakUsVUFBTSxTQUFTLE1BQU0sVUFBVSxNQUFNLEtBQUssUUFBUSxRQUFRLFNBQVMsSUFBSSxDQUFDO0FBQ3hFLFdBQU8sV0FBVyxNQUFNO0FBQUEsRUFDMUI7QUFBQSxFQUVBLE1BQWMsY0FBYyxNQUFnQztBQUMxRCxRQUFJO0FBQ0YsYUFBTyxNQUFNLEtBQUssUUFBUSxRQUFRLE9BQU8sSUFBSTtBQUFBLElBQy9DLFNBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGlCQUFpQixRQUErQjtBQUN0RCxRQUFJLE9BQU8sU0FBUyxZQUFZLE9BQU8sYUFBYSxRQUFXO0FBQzdELGFBQU87QUFBQSxRQUNMLE1BQU07QUFBQSxRQUNOLFVBQVUsT0FBTztBQUFBLFFBQ2pCLFFBQVEsT0FBTztBQUFBLFFBQ2YsTUFBTSxPQUFPO0FBQUEsUUFDYixNQUFNLE9BQU87QUFBQSxRQUNiLFNBQVMsT0FBTztBQUFBLFFBQ2hCLE9BQU8sT0FBTztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSxLQUFLLE1BQU0sT0FBTyxJQUFJO0FBQ3BDLFVBQU0sT0FBMkIsT0FBTyxVQUNwQyxXQUNBLFVBQVUsU0FDUixRQUNBLE1BQU0sY0FBYyxTQUNsQixZQUNBO0FBQ1IsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiLFNBQVMsT0FBTztBQUFBLE1BQ2hCLE9BQU8sT0FBTztBQUFBLE1BQ2QsU0FBUyxPQUFPO0FBQUEsTUFDaEIsR0FBSSxPQUFPLGFBQWEsT0FBTyxFQUFFLFVBQVUsS0FBSyxJQUFJLENBQUM7QUFBQSxJQUN2RDtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsTUFBYyxXQUFXLE9BQW1EO0FBQzFFLFdBQU87QUFBQSxNQUNMLEtBQUssUUFBUTtBQUFBLE1BQ2IsS0FBSztBQUFBLE1BQ0wsRUFBRSxRQUFRLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxLQUFLLEdBQUcsV0FBVyxDQUFDLEdBQUcsY0FBYyxDQUFDLEVBQUU7QUFBQSxNQUNqRSxLQUFLO0FBQUEsTUFDTCxFQUFFLEtBQUssS0FBSyxJQUFJLEVBQUU7QUFBQSxJQUNwQjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBSVEsY0FBYyxRQUErQztBQUNuRSxVQUFNLFdBQVcsT0FBTyxPQUFPLENBQUMsVUFBVSxDQUFDLFVBQVUsTUFBTSxNQUFNLEtBQUssY0FBYyxDQUFDO0FBQ3JGLFFBQUksU0FBUyxXQUFXLEVBQUc7QUFDM0IsU0FBSyxXQUFXLFNBQVM7QUFDekIsU0FBSyxrQkFBa0I7QUFBQSxFQUN6QjtBQUFBO0FBQUEsRUFHUSxvQkFBMEI7QUFwZHBDO0FBcWRJLGVBQUssbUJBQUw7QUFDQSxTQUFLLGlCQUFpQixLQUFLLFNBQVMsTUFBTTtBQUN4QyxXQUFLLGlCQUFpQjtBQUN0QixXQUFLLFFBQVEsTUFBTSxLQUFLLFNBQVMsQ0FBQyxFQUFFO0FBQUEsUUFBTSxDQUFDLFVBQ3pDLEtBQUssSUFBSSxLQUFLLCtCQUErQixLQUFLO0FBQUEsTUFDcEQ7QUFBQSxJQUNGLEdBQUcsS0FBSyxVQUFVO0FBQUEsRUFDcEI7QUFBQTtBQUFBLEVBSUEsTUFBYyxXQUEwQjtBQWhlMUM7QUFpZUksUUFBSSxLQUFLLGNBQWMsUUFBUSxLQUFLLGVBQWUsRUFBRztBQUN0RCxTQUFLLFFBQVE7QUFDYixRQUFJO0FBQ0YsWUFBTSxXQUFXLE1BQU0sS0FBSyxjQUFjO0FBQzFDLFlBQU0sZUFBZSxNQUFNO0FBQUEsUUFDekIsS0FBSyxRQUFRO0FBQUEsUUFDYixLQUFLO0FBQUEsUUFDTCxLQUFLO0FBQUEsUUFDTCxLQUFLLElBQUk7QUFBQSxNQUNYO0FBQ0EsWUFBTSxPQUFPLGdCQUFnQjtBQUFBLFFBQzNCO0FBQUEsUUFDQSxPQUFPLEtBQUs7QUFBQSxRQUNaO0FBQUEsUUFDQSxjQUFjLEtBQUssUUFBUTtBQUFBLFFBQzNCLGdCQUFnQixLQUFLLFFBQVE7QUFBQSxRQUM3QixLQUFLLEtBQUssSUFBSTtBQUFBLE1BQ2hCLENBQUM7QUFDRCxXQUFLLFlBQVksQ0FBQyxHQUFHLEtBQUssV0FBVyxHQUFHLEtBQUssU0FBUztBQUl0RCxZQUFNLFNBQVMsTUFBTSxLQUFLLFlBQVksSUFBSTtBQUUxQyxXQUFLLFFBQVEsTUFBTSxLQUFLLFdBQVcsS0FBSyxLQUFLO0FBRTdDLGlCQUFXLFVBQVUsUUFBUTtBQUMzQixjQUFNLEtBQUssV0FBVyxNQUFNO0FBQUEsTUFDOUI7QUFDQSxpQkFBVyxRQUFRLEtBQUssY0FBYztBQUNwQyxjQUFNLEtBQUssV0FBVztBQUFBLFVBQ3BCLE1BQU07QUFBQSxVQUNOO0FBQUEsVUFDQSxnQkFBZSxnQkFBSyxNQUFNLElBQUksTUFBZixtQkFBa0IsY0FBbEIsWUFBK0I7QUFBQSxVQUM5QyxNQUFNO0FBQUEsVUFDTixNQUFNO0FBQUEsVUFDTixVQUFVO0FBQUEsUUFDWixDQUFDO0FBQUEsTUFDSDtBQUVBLFdBQUssYUFBYSxLQUFLLElBQUk7QUFDM0IsV0FBSyxVQUFVO0FBQ2YsVUFBSSxDQUFDLEtBQUssZUFBZSxFQUFHLE1BQUssUUFBUTtBQUFBLElBQzNDLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxNQUFNLHFCQUFxQixLQUFLO0FBQ3pDLFVBQUksQ0FBQyxLQUFLLGVBQWUsRUFBRyxNQUFLLFFBQVEsS0FBSyxjQUFjLE9BQU8sU0FBUztBQUM1RSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsZ0JBQXVDO0FBQ25ELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsY0FBYyxFQUFFLFNBQVM7QUFBQSxNQUMzQyxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sY0FBYyxDQUFDO0FBQUEsSUFDOUM7QUFDQSxRQUFJLE1BQU0sU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLEtBQUs7QUFDcEQsUUFBSSxNQUFNLFNBQVMsS0FBSyxPQUFRLE1BQUssU0FBUyxNQUFNO0FBQ3BELFdBQU8sT0FBTyxPQUFPLE1BQU0sT0FBTyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsR0FBRyxNQUFNLEVBQUU7QUFBQSxFQUNuRTtBQUFBLEVBRUEsTUFBYyxZQUFZLE1BQXlDO0FBL2hCckU7QUFpaUJJLFVBQU0sY0FBYyxvQkFBSSxJQUFvQjtBQUM1QyxlQUFXLFlBQVksS0FBSyxXQUFXO0FBQ3JDLFVBQUksU0FBUyxxQkFBcUIsUUFBVztBQUMzQyxvQkFBWSxJQUFJLFNBQVMsa0JBQWtCLFNBQVMsSUFBSTtBQUFBLE1BQzFEO0FBQUEsSUFDRjtBQUVBLFVBQU0sU0FBeUIsQ0FBQztBQUNoQyxlQUFXLFFBQVEsS0FBSyxRQUFRO0FBQzlCLFVBQUksS0FBSyxTQUFTLFlBQVksS0FBSyxTQUFTLFVBQVU7QUFDcEQsZUFBTyxLQUFLLEtBQUssU0FBUyxJQUFJLENBQUM7QUFDL0I7QUFBQSxNQUNGO0FBQ0EsWUFBTSxhQUNKLEtBQUssU0FBUyxrQkFBaUIsaUJBQVksSUFBSSxLQUFLLElBQUksTUFBekIsWUFBOEIsS0FBSyxPQUFPLEtBQUs7QUFDaEYsWUFBTSxRQUFRLE1BQU0sS0FBSyxVQUFVLFVBQVU7QUFDN0MsVUFBSSxVQUFVLFFBQVc7QUFDdkIsYUFBSyxJQUFJLEtBQUssOENBQThDLEtBQUssSUFBSTtBQUNyRSxhQUFLLGtCQUFrQjtBQUN2QjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sTUFBTSxVQUFVLEtBQUs7QUFDbEMsVUFBSSxTQUFTLEtBQUssUUFBUSxNQUFNLGVBQWUsS0FBSyxNQUFNO0FBQ3hELGFBQUssSUFBSSxLQUFLLG9EQUFvRCxLQUFLLElBQUk7QUFDM0UsYUFBSyxrQkFBa0I7QUFDdkI7QUFBQSxNQUNGO0FBQ0EsVUFBSSxLQUFLLFNBQVMsZ0JBQWdCO0FBSWhDLGNBQU0sS0FBSyxRQUFRLFFBQVEsVUFBVSxLQUFLLE1BQU0sS0FBSztBQUFBLE1BQ3ZEO0FBQ0EsYUFBTyxLQUFLLEVBQUUsR0FBRyxLQUFLLFNBQVMsSUFBSSxHQUFHLE1BQU0sQ0FBQztBQUFBLElBQy9DO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLFNBQVMsTUFBNEI7QUFDM0MsUUFBSSxLQUFLLFNBQVMsVUFBVTtBQUMxQixhQUFPO0FBQUEsUUFDTCxNQUFNO0FBQUEsUUFDTixNQUFNLEtBQUs7QUFBQSxRQUNYLGVBQWUsS0FBSztBQUFBLFFBQ3BCLE1BQU0sS0FBSztBQUFBLFFBQ1gsTUFBTSxLQUFLO0FBQUEsUUFDWCxVQUFVLEtBQUs7QUFBQSxNQUNqQjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsTUFDTCxNQUFNLEtBQUssU0FBUyxRQUFRLFNBQVMsS0FBSztBQUFBLE1BQzFDLE1BQU0sS0FBSztBQUFBLE1BQ1gsZUFBZSxLQUFLO0FBQUEsTUFDcEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxJQUNiO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxVQUFVLE1BQStDO0FBQ3JFLFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxRQUFRLFFBQVEsU0FBUyxJQUFJO0FBQUEsSUFDakQsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxXQUFXLFFBQXFDO0FBQzVELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFFOUQsVUFBTSxVQUF5QjtBQUFBLE1BQzdCLE1BQU07QUFBQSxNQUNOLE1BQU0sT0FBTztBQUFBLE1BQ2IsZUFBZSxPQUFPO0FBQUEsTUFDdEIsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsR0FBSSxPQUFPLGFBQWEsU0FBWSxFQUFFLFVBQVUsT0FBTyxTQUFTLElBQUksQ0FBQztBQUFBLE1BQ3JFLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDckQsR0FBSSxPQUFPLFVBQVUsVUFBYSxPQUFPLE1BQU0sY0FBYywyQkFDekQsRUFBRSxRQUFRLGNBQWMsT0FBTyxLQUFLLEVBQUUsSUFDdEMsQ0FBQztBQUFBLElBQ1A7QUFHQSxRQUFJLE9BQU8sVUFBVSxVQUFhLE9BQU8sTUFBTSxhQUFhLDBCQUEwQjtBQUNwRixZQUFNLEtBQUssV0FBVyxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQUEsSUFDakQ7QUFFQSxVQUFNLFFBQVEsTUFBTSxLQUFLO0FBQUEsTUFDdkIsQ0FBQyxNQUFNLEVBQUUsU0FBUyxlQUFlLEVBQUUsU0FBUyxjQUFjLEVBQUUsU0FBUztBQUFBLE1BQ3JFLE1BQU0sVUFBVSxLQUFLLE9BQU87QUFBQSxJQUM5QjtBQUNBLFFBQUksTUFBTSxTQUFTLFFBQVMsT0FBTSxLQUFLLFFBQVEsS0FBSztBQUVwRCxRQUFJLE1BQU0sU0FBUyxhQUFhO0FBQzlCLFVBQUksTUFBTSxNQUFNLEtBQUssT0FBUSxNQUFLLFNBQVMsTUFBTTtBQUNqRCxXQUFLLGdCQUFnQixRQUFRLE1BQU0sU0FBUyxNQUFNLEtBQUs7QUFDdkQ7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLLG9CQUFvQixRQUFRLEtBQUs7QUFBQSxFQUM5QztBQUFBLEVBRVEsZ0JBQWdCLFFBQXNCLFdBQW1CLE9BQTJCO0FBQzFGLFVBQU0sVUFBVSxPQUFPLFNBQVM7QUFDaEMsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUM3RCxXQUFLLFFBQVEsWUFBWSxZQUFZLEtBQUssT0FBTyxPQUFPLFFBQVEsR0FBRztBQUFBLFFBQ2pFLE1BQU0sT0FBTztBQUFBLFFBQ2I7QUFBQSxRQUNBLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDYjtBQUFBLE1BQ0YsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUNBLFNBQUssUUFBUSxZQUFZLEtBQUssT0FBTztBQUFBLE1BQ25DLE1BQU0sT0FBTztBQUFBLE1BQ2I7QUFBQSxNQUNBLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYjtBQUFBLE1BQ0E7QUFBQSxNQUNBLFdBQVcsVUFBVSxLQUFLLElBQUksSUFBSTtBQUFBLE1BQ2xDLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsSUFDdkQsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsb0JBQ1osUUFDQSxPQUNlO0FBQ2YsUUFBSSxNQUFNLFFBQVEsVUFBYSxNQUFNLE1BQU0sS0FBSyxPQUFRLE1BQUssU0FBUyxNQUFNO0FBQzVFLFVBQU0sUUFDSixNQUFNLE9BQU8sYUFBYSxLQUFLLFFBQVEsWUFBWSxNQUFNLE9BQU8sU0FBUyxPQUFPO0FBQ2xGLFFBQUksT0FBTztBQUNULFdBQUssZ0JBQWdCLFFBQVEsTUFBTSxPQUFPLElBQUksTUFBTSxPQUFPLEtBQUs7QUFDaEU7QUFBQSxJQUNGO0FBTUEsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsTUFBTTtBQUNwRixZQUFNLFFBQVEsTUFBTSxLQUFLLFVBQVUsT0FBTyxJQUFJO0FBQzlDLFVBQUksVUFBVSxVQUFjLE1BQU0sVUFBVSxLQUFLLE1BQU8sT0FBTyxNQUFNO0FBQ25FLGFBQUssa0JBQWtCO0FBQ3ZCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxRQUFJLE9BQU8sU0FBUyxZQUFZLE9BQU8sYUFBYSxRQUFXO0FBRzdELFdBQUssUUFBUSxZQUFZLEtBQUssT0FBTztBQUFBLFFBQ25DLE1BQU0sTUFBTSxPQUFPO0FBQUEsUUFDbkIsV0FBVyxNQUFNLE9BQU87QUFBQSxRQUN4QixNQUFNLE1BQU0sT0FBTztBQUFBLFFBQ25CLE1BQU0sTUFBTSxPQUFPO0FBQUEsUUFDbkIsT0FBTyxNQUFNLE9BQU87QUFBQSxNQUN0QixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsU0FBSyxRQUFRLE1BQU0sS0FBSyxXQUFXLENBQUMsS0FBSyxhQUFhLE1BQU0sTUFBTSxDQUFDLENBQUM7QUFBQSxFQUN0RTtBQUFBO0FBQUEsRUFHUSxhQUFhLFFBUVY7QUFDVCxVQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxVQUFNLFVBQVUsT0FBTyxTQUFTO0FBQ2hDLFVBQU0sT0FBMkIsVUFDN0IsV0FDQSxVQUFVLFNBQ1IsUUFDQSxNQUFNLGNBQWMsU0FDbEIsWUFDQTtBQUNSLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixTQUFTLE9BQU87QUFBQSxNQUNoQixPQUFPLE9BQU87QUFBQSxNQUNkO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsV0FBVyxNQUFjLE9BQWtDO0FBQ3ZFLFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsYUFBYSxFQUFFLFNBQVM7QUFBQSxNQUMxQyxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sV0FBVyxNQUFNLFNBQVMsY0FBYyxLQUFLLEVBQUUsQ0FBQztBQUFBLElBQy9FO0FBQ0EsUUFBSSxNQUFNLFNBQVMsUUFBUyxPQUFNLEtBQUssUUFBUSxLQUFLO0FBQ3BELFVBQU0sS0FBSyxRQUFRLFVBQVUsSUFBSSxNQUFNLEtBQUs7QUFBQSxFQUM5QztBQUFBLEVBV0EsTUFBYyxhQUFhLE1BQW1DO0FBQzVELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTyxFQUFFLFNBQVMsVUFBVSxFQUFFLFNBQVMsUUFBUyxFQUFFLFNBQVM7QUFBQSxNQUM1RCxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sV0FBVyxLQUFLLENBQUM7QUFBQSxJQUNoRDtBQUNBLFFBQUksTUFBTSxTQUFTLFFBQVMsT0FBTSxLQUFLLFFBQVEsS0FBSztBQUNwRCxVQUFNLFFBQVEsY0FBYyxNQUFNLE9BQU87QUFDekMsUUFBSyxNQUFNLFVBQVUsS0FBSyxNQUFPLE1BQU07QUFDckMsWUFBTSxJQUFJLGNBQWMsUUFBUSxJQUFJLGtDQUFrQztBQUFBLElBQ3hFO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBSVEsUUFDTixTQUNBLE1BQ1k7QUFDWixXQUFPLElBQUksUUFBVyxDQUFDLFNBQVMsV0FBVztBQUN6QyxXQUFLLGNBQWM7QUFBQSxRQUNqQixTQUFTLENBQUMsWUFBWSxRQUFRLE9BQU87QUFBQSxRQUNyQyxTQUFTLENBQUMsWUFBWSxRQUFRLE9BQVk7QUFBQSxRQUMxQztBQUFBLE1BQ0Y7QUFDQSxVQUFJO0FBQ0YsYUFBSztBQUFBLE1BQ1AsU0FBUyxPQUFPO0FBQ2QsYUFBSyxjQUFjO0FBQ25CLGVBQU8saUJBQWlCLFFBQVEsUUFBUSxJQUFJLGFBQWEsT0FBTyxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQ3pFO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsUUFBUSxTQUFvQztBQUNsRCxZQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3BCLEtBQUs7QUFDSCxlQUFPLElBQUksa0JBQWtCLFFBQVEsT0FBTztBQUFBLE1BQzlDLEtBQUs7QUFDSCxlQUFPLElBQUksYUFBYSxRQUFRLE9BQU87QUFBQSxNQUN6QztBQUNFLGVBQU8sSUFBSSxjQUFjLFFBQVEsT0FBTztBQUFBLElBQzVDO0FBQUEsRUFDRjtBQUFBLEVBRVEsUUFBUSxXQUErQztBQUM3RCxTQUFLLGFBQWE7QUFDbEIsVUFBTSxNQUFNLEtBQUssS0FBSyxLQUFLLFdBQVcsU0FBUztBQUMvQyxVQUFNLFVBQVUsSUFBSTtBQUFBLE1BQ2xCLE1BQU07QUFDSixhQUFLLGFBQWE7QUFDbEIsYUFBSyxhQUFhO0FBQUEsTUFDcEI7QUFBQSxNQUNBLENBQUMsVUFBbUI7QUFDbEIsYUFBSyxhQUFhO0FBQ2xCLGFBQUssYUFBYTtBQUNsQixjQUFNO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFHQSxTQUFLLE9BQU8sUUFBUTtBQUFBLE1BQ2xCLE1BQU07QUFBQSxNQUFDO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFBQztBQUFBLElBQ1Q7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRVEsZUFBcUI7QUFDM0IsVUFBTSxXQUFXLG9CQUFvQixLQUFLLEtBQUs7QUFDL0MsU0FBSyxLQUFLLFFBQVEsUUFDZixVQUFVLHdCQUF3QixJQUFJLFlBQVksRUFBRSxPQUFPLFFBQVEsQ0FBQyxFQUNwRSxNQUFNLENBQUMsVUFBbUIsS0FBSyxJQUFJLEtBQUssaUNBQWlDLEtBQUssQ0FBQztBQUFBLEVBQ3BGO0FBQ0Y7OztBQ2h6Qk8sSUFBTSxzQkFBc0I7QUFZNUIsSUFBTSx5QkFBTixNQUF1RDtBQUFBLEVBUzVELFlBQVksU0FBd0M7QUFScEQsd0JBQWlCO0FBS2pCO0FBQUE7QUFBQTtBQUFBO0FBQUEsd0JBQVEsb0JBQW1CO0FBQzNCLHdCQUFRLGVBQWM7QUFHcEIsU0FBSyxVQUFVLFFBQVE7QUFBQSxFQUN6QjtBQUFBO0FBQUE7QUFBQSxFQUtRLGNBQWMsV0FBMkI7QUFDL0MsVUFBTSxhQUFhLG1CQUFtQixTQUFTO0FBQy9DLFdBQU8sZUFBZSxNQUFNLE1BQU0sV0FBVyxNQUFNLENBQUM7QUFBQSxFQUN0RDtBQUFBO0FBQUEsRUFJQSxNQUFNLFNBQVMsTUFBbUM7QUFDaEQsVUFBTSxTQUFTLE1BQU0sS0FBSyxRQUFRLFdBQVcsS0FBSyxjQUFjLElBQUksQ0FBQztBQUNyRSxXQUFPLElBQUksV0FBVyxNQUFNO0FBQUEsRUFDOUI7QUFBQSxFQUVBLE1BQU0sVUFBVSxNQUFjLE1BQWlDO0FBQzdELFVBQU0sU0FBUyxLQUFLLGNBQWMsSUFBSTtBQUN0QyxVQUFNLEtBQUssaUJBQWlCLE1BQU07QUFHbEMsVUFBTSxTQUFTLElBQUksWUFBWSxLQUFLLFVBQVU7QUFDOUMsUUFBSSxXQUFXLE1BQU0sRUFBRSxJQUFJLElBQUk7QUFFL0IsUUFBSSxLQUFLLGtCQUFrQjtBQUN6QixZQUFNLEtBQUssUUFBUSxZQUFZLFFBQVEsTUFBTTtBQUM3QztBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sTUFBTSxLQUFLLFNBQVM7QUFDakMsUUFBSTtBQUNGLFlBQU0sS0FBSyxRQUFRLFlBQVksTUFBTSxNQUFNO0FBQzNDLFlBQU0sS0FBSyxRQUFRLE9BQU8sTUFBTSxNQUFNO0FBQUEsSUFDeEMsU0FBUTtBQUlOLFlBQU0sS0FBSyxhQUFhLElBQUk7QUFDNUIsV0FBSyxtQkFBbUI7QUFDeEIsWUFBTSxLQUFLLFFBQVEsWUFBWSxRQUFRLE1BQU07QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sV0FBVyxNQUE2QjtBQUM1QyxVQUFNLFNBQVMsS0FBSyxjQUFjLElBQUk7QUFFdEMsUUFBSSxDQUFFLE1BQU0sS0FBSyxRQUFRLE9BQU8sTUFBTSxFQUFJO0FBQzFDLFFBQUk7QUFDRixZQUFNLEtBQUssUUFBUSxPQUFPLE1BQU07QUFBQSxJQUNsQyxTQUFRO0FBRU4sVUFBSSxNQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sRUFBRyxPQUFNLElBQUksTUFBTSxvQkFBb0IsTUFBTSxFQUFFO0FBQUEsSUFDckY7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFdBQVcsTUFBYyxJQUEyQjtBQUN4RCxVQUFNLFdBQVcsS0FBSyxjQUFjLElBQUk7QUFDeEMsVUFBTSxTQUFTLEtBQUssY0FBYyxFQUFFO0FBQ3BDLFVBQU0sS0FBSyxpQkFBaUIsTUFBTTtBQUNsQyxVQUFNLEtBQUssUUFBUSxPQUFPLFVBQVUsTUFBTTtBQUFBLEVBQzVDO0FBQUEsRUFFQSxNQUFNLFlBQTBDO0FBQzlDLFVBQU0sUUFBb0IsQ0FBQztBQUMzQixVQUFNLEtBQUssVUFBVSxLQUFLLE9BQU8sZ0JBQWdCO0FBQy9DLFlBQU0sT0FBTyxNQUFNLEtBQUssV0FBVyxXQUFXO0FBQzlDLFVBQUksU0FBUyxLQUFNO0FBQ25CLFlBQU0sS0FBSztBQUFBLFFBQ1QsTUFBTSxJQUFJLFdBQVc7QUFBQSxRQUNyQixNQUFNLEtBQUs7QUFBQSxRQUNYLE9BQU8sS0FBSztBQUFBLE1BQ2QsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUNELFVBQU0sS0FBSyxDQUFDLEdBQUcsTUFBTyxFQUFFLE9BQU8sRUFBRSxPQUFPLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxJQUFJLENBQUU7QUFDckUsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sV0FBdUM7QUFDM0MsVUFBTSxPQUFpQixDQUFDLEdBQUc7QUFDM0IsVUFBTSxLQUFLLFlBQVksS0FBSyxPQUFPLGdCQUFnQjtBQUNqRCxXQUFLLEtBQUssSUFBSSxXQUFXLEVBQUU7QUFBQSxJQUM3QixDQUFDO0FBQ0QsU0FBSyxLQUFLLENBQUMsR0FBRyxNQUFPLElBQUksSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJLENBQUU7QUFDaEQsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sVUFBVSxNQUE2QjtBQUMzQyxVQUFNLGFBQWEsbUJBQW1CLElBQUk7QUFDMUMsVUFBTSxXQUFXLGVBQWUsTUFBTSxDQUFDLElBQUksV0FBVyxNQUFNLENBQUMsRUFBRSxNQUFNLEdBQUc7QUFDeEUsUUFBSSxVQUFVO0FBQ2QsZUFBVyxXQUFXLFVBQVU7QUFDOUIsZ0JBQVUsWUFBWSxLQUFLLFVBQVUsR0FBRyxPQUFPLElBQUksT0FBTztBQUMxRCxVQUFJLENBQUUsTUFBTSxLQUFLLFFBQVEsT0FBTyxPQUFPLEVBQUksT0FBTSxLQUFLLFFBQVEsTUFBTSxPQUFPO0FBQUEsSUFDN0U7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLE9BQU8sTUFBZ0M7QUFDM0MsVUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLFFBQUksZUFBZSxJQUFLLFFBQU87QUFDL0IsUUFBSTtBQUNGLGFBQU8sTUFBTSxLQUFLLFFBQVEsT0FBTyxLQUFLLGNBQWMsVUFBVSxDQUFDO0FBQUEsSUFDakUsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFJQSxNQUFjLFdBQVcsYUFBa0Q7QUFDekUsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLEtBQUssUUFBUSxLQUFLLFdBQVc7QUFDaEQsVUFBSSxTQUFTLFFBQVEsS0FBSyxTQUFTLE9BQVEsUUFBTztBQUNsRCxhQUFPLEVBQUUsTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLLE1BQU07QUFBQSxJQUM5QyxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsV0FBNEI7QUFDeEMsVUFBTSxLQUFLLFVBQVUsbUJBQW1CO0FBQ3hDLFNBQUssZUFBZTtBQUNwQixXQUFPLEdBQUcsb0JBQW9CLE1BQU0sQ0FBQyxDQUFDLE1BQU0sS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUMsSUFBSSxLQUFLLFdBQVc7QUFBQSxFQUN6RjtBQUFBLEVBRUEsTUFBYyxhQUFhLGFBQW9DO0FBQzdELFFBQUk7QUFDRixZQUFNLEtBQUssUUFBUSxPQUFPLFdBQVc7QUFBQSxJQUN2QyxTQUFRO0FBQUEsSUFFUjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsTUFBYyxpQkFBaUIsYUFBb0M7QUFDakUsVUFBTSxRQUFRLFlBQVksWUFBWSxHQUFHO0FBQ3pDLFFBQUksU0FBUyxFQUFHO0FBQ2hCLFVBQU0sU0FBUyxZQUFZLE1BQU0sR0FBRyxLQUFLO0FBQ3pDLFVBQU0sS0FBSyxVQUFVLElBQUksTUFBTSxFQUFFO0FBQUEsRUFDbkM7QUFBQTtBQUFBLEVBR0EsTUFBYyxVQUNaLGdCQUNBLE9BQ2U7QUFDZixRQUFJO0FBQ0osUUFBSTtBQUNGLGdCQUFVLE1BQU0sS0FBSyxRQUFRLEtBQUssY0FBYztBQUFBLElBQ2xELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxlQUFXLFFBQVEsUUFBUSxNQUFPLE9BQU0sTUFBTSxJQUFJO0FBQ2xELGVBQVcsVUFBVSxRQUFRLFFBQVMsT0FBTSxLQUFLLFVBQVUsUUFBUSxLQUFLO0FBQUEsRUFDMUU7QUFBQTtBQUFBLEVBR0EsTUFBYyxZQUNaLGdCQUNBLE9BQ2U7QUFDZixRQUFJO0FBQ0osUUFBSTtBQUNGLGdCQUFVLE1BQU0sS0FBSyxRQUFRLEtBQUssY0FBYztBQUFBLElBQ2xELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxlQUFXLFVBQVUsUUFBUSxTQUFTO0FBQ3BDLFlBQU0sTUFBTSxNQUFNO0FBQ2xCLFlBQU0sS0FBSyxZQUFZLFFBQVEsS0FBSztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUNGOzs7QUNsTU8sSUFBTSx1QkFBTixNQUFtRDtBQUFBLEVBS3hELFlBQVksU0FBc0M7QUFKbEQsd0JBQWlCO0FBQ2pCLHdCQUFRLFFBQW1CLENBQUM7QUFDNUIsd0JBQVEsUUFBOEQ7QUFHcEUsU0FBSyxRQUFRLFFBQVE7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSxJQUF3RDtBQUM1RCxTQUFLLEtBQUs7QUFDVixTQUFLLE9BQU87QUFJWixTQUFLLE9BQU87QUFBQSxNQUNWLEtBQUssTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUF3QjtBQUMvQyxhQUFLLFFBQVEsRUFBRSxNQUFNLE9BQU8sTUFBTSxZQUFZLElBQUksRUFBRSxDQUFDO0FBQUEsTUFDdkQsQ0FBQztBQUFBLE1BQ0QsS0FBSyxNQUFNLEdBQUcsVUFBVSxDQUFDLFNBQXdCO0FBQy9DLGFBQUssUUFBUSxFQUFFLE1BQU0sVUFBVSxNQUFNLFlBQVksSUFBSSxFQUFFLENBQUM7QUFBQSxNQUMxRCxDQUFDO0FBQUEsTUFDRCxLQUFLLE1BQU0sR0FBRyxVQUFVLENBQUMsU0FBd0I7QUFDL0MsYUFBSyxRQUFRLEVBQUUsTUFBTSxVQUFVLE1BQU0sWUFBWSxJQUFJLEVBQUUsQ0FBQztBQUFBLE1BQzFELENBQUM7QUFBQSxNQUNELEtBQUssTUFBTSxHQUFHLFVBQVUsQ0FBQyxNQUFxQixZQUFvQjtBQUVoRSxhQUFLLFFBQVEsRUFBRSxNQUFNLFVBQVUsTUFBTSxJQUFJLE9BQU8sSUFBSSxRQUFRLFlBQVksSUFBSSxFQUFFLENBQUM7QUFBQSxNQUNqRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE9BQWE7QUFDWCxlQUFXLE9BQU8sS0FBSyxLQUFNLE1BQUssTUFBTSxPQUFPLEdBQUc7QUFDbEQsU0FBSyxPQUFPLENBQUM7QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQUEsRUFFUSxRQUFRLE9BQThCO0FBN0RoRDtBQThESSxlQUFLLFNBQUwsOEJBQVksQ0FBQyxLQUFLO0FBQUEsRUFDcEI7QUFDRjtBQUdBLFNBQVMsWUFBWSxNQUE2QjtBQUNoRCxTQUFPLEtBQUssS0FBSyxXQUFXLEdBQUcsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLElBQUk7QUFDOUQ7QUFzQk8sSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBWTNCLFlBQVksU0FBaUM7QUFYN0Msd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUVqQix3QkFBUSxPQUEyQjtBQUNuQyx3QkFBUSxrQkFBMEI7QUFDbEMsd0JBQVE7QUFDUix3QkFBUSxjQUFzQjtBQXJHaEM7QUF3R0ksU0FBSyxhQUFhLFFBQVE7QUFDMUIsU0FBSyxlQUFjLGFBQVEsZ0JBQVIsWUFBdUI7QUFDMUMsU0FBSyxtQkFBa0IsYUFBUSxvQkFBUixhQUE0QixDQUFDLElBQUksT0FBTyxZQUFZLElBQUksRUFBRTtBQUNqRixTQUFLLHFCQUFvQixhQUFRLHNCQUFSLGFBQThCLENBQUMsV0FBVyxjQUFjLE1BQWdCO0FBQ2pHLFNBQUssa0JBQWlCLGFBQVEsbUJBQVIsYUFBMkIsQ0FBQyxJQUFJLE9BQU8sV0FBVyxJQUFJLEVBQUU7QUFDOUUsU0FBSyxvQkFBbUIsYUFBUSxxQkFBUixhQUE2QixDQUFDLFdBQVcsYUFBYSxNQUFnQjtBQUFBLEVBQ2hHO0FBQUE7QUFBQSxFQUdBLE1BQU0sS0FBdUI7QUFDM0IsU0FBSyxLQUFLO0FBQ1YsU0FBSyxNQUFNO0FBQ1gsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQSxFQUVBLE9BQWE7QUFDWCxTQUFLLHNCQUFzQjtBQUMzQixRQUFJLEtBQUssZUFBZSxNQUFNO0FBQzVCLFdBQUssaUJBQWlCLEtBQUssVUFBVTtBQUNyQyxXQUFLLGFBQWE7QUFBQSxJQUNwQjtBQUNBLFNBQUssTUFBTTtBQUFBLEVBQ2I7QUFBQTtBQUFBLEVBR0EsY0FBYyxJQUFrQjtBQUM5QixTQUFLLGFBQWE7QUFDbEIsUUFBSSxLQUFLLFFBQVEsTUFBTTtBQUNyQixXQUFLLHNCQUFzQjtBQUMzQixXQUFLLFlBQVk7QUFBQSxJQUNuQjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsT0FBYTtBQUNYLFFBQUksS0FBSyxRQUFRLEtBQU07QUFDdkIsUUFBSSxLQUFLLGVBQWUsS0FBTTtBQUM5QixTQUFLLGFBQWEsS0FBSyxlQUFlLE1BQU07QUE3SWhEO0FBOElNLFdBQUssYUFBYTtBQUNsQixpQkFBSyxRQUFMO0FBQUEsSUFDRixHQUFHLEtBQUssV0FBVztBQUFBLEVBQ3JCO0FBQUEsRUFFQSxJQUFJLGtCQUEwQjtBQUM1QixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFFUSxjQUFvQjtBQUMxQixRQUFJLEtBQUssY0FBYyxLQUFLLEtBQUssUUFBUSxLQUFNO0FBQy9DLFNBQUssaUJBQWlCLEtBQUssZ0JBQWdCLE1BQUc7QUF6SmxEO0FBeUpxRCx3QkFBSyxRQUFMO0FBQUEsT0FBYyxLQUFLLFVBQVU7QUFBQSxFQUNoRjtBQUFBLEVBRVEsd0JBQThCO0FBQ3BDLFFBQUksS0FBSyxtQkFBbUIsTUFBTTtBQUNoQyxXQUFLLGtCQUFrQixLQUFLLGNBQWM7QUFDMUMsV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFDRjs7O0FDdkpPLElBQU0sZ0JBQU4sY0FBNEIsTUFBTTtBQUFBLEVBQ3ZDLFlBQ1csUUFDVCxTQUNBO0FBQ0EsVUFBTSxPQUFPO0FBSEo7QUFJVCxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFXTyxJQUFNLGdCQUFOLE1BQXlDO0FBQUEsRUFLOUMsWUFBWSxTQUErQjtBQUozQyx3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQWpDbkI7QUFvQ0ksU0FBSyxPQUFPLFFBQVEsUUFBUSxRQUFRLFFBQVEsRUFBRTtBQUM5QyxTQUFLLFFBQVEsUUFBUTtBQUNyQixTQUFLLFdBQVUsYUFBUSxjQUFSLFlBQXFCO0FBQUEsRUFDdEM7QUFBQTtBQUFBLEVBR0EsTUFBTSxJQUFJLE1BQStDO0FBQ3ZELFVBQU0sV0FBVyxNQUFNLEtBQUssUUFBUSxHQUFHLEtBQUssSUFBSSxTQUFTLElBQUksSUFBSTtBQUFBLE1BQy9ELFNBQVMsRUFBRSxlQUFlLFVBQVUsS0FBSyxLQUFLLEdBQUc7QUFBQSxJQUNuRCxDQUFDO0FBQ0QsUUFBSSxTQUFTLFdBQVcsSUFBSyxRQUFPO0FBQ3BDLFFBQUksQ0FBQyxTQUFTLElBQUk7QUFDaEIsWUFBTSxJQUFJLGNBQWMsU0FBUyxRQUFRLE1BQU0sYUFBYSxVQUFVLFlBQVksQ0FBQztBQUFBLElBQ3JGO0FBQ0EsV0FBTyxJQUFJLFdBQVcsTUFBTSxTQUFTLFlBQVksQ0FBQztBQUFBLEVBQ3BEO0FBQUE7QUFBQSxFQUdBLE1BQU0sSUFBSSxNQUFjLE9BQWtDO0FBQ3hELFVBQU0sV0FBVyxNQUFNLEtBQUssUUFBUSxHQUFHLEtBQUssSUFBSSxTQUFTLElBQUksSUFBSTtBQUFBLE1BQy9ELFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNQLGVBQWUsVUFBVSxLQUFLLEtBQUs7QUFBQSxRQUNuQyxnQkFBZ0I7QUFBQSxNQUNsQjtBQUFBLE1BQ0EsTUFBTTtBQUFBLElBQ1IsQ0FBQztBQUNELFFBQUksQ0FBQyxTQUFTLElBQUk7QUFDaEIsWUFBTSxJQUFJLGNBQWMsU0FBUyxRQUFRLE1BQU0sYUFBYSxVQUFVLFlBQVksQ0FBQztBQUFBLElBQ3JGO0FBQUEsRUFDRjtBQUNGO0FBRUEsZUFBZSxhQUFhLFVBQW9CLE1BQStCO0FBQzdFLFFBQU0sVUFBVSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sTUFBTSxFQUFFLEdBQUcsTUFBTSxHQUFHLEdBQUc7QUFDbkUsU0FBTyxXQUFXLEtBQ2QsYUFBYSxJQUFJLFVBQVUsU0FBUyxNQUFNLEtBQzFDLGFBQWEsSUFBSSxVQUFVLFNBQVMsTUFBTSxLQUFLLE1BQU07QUFDM0Q7OztBQ2hFQSxzQkFBeUI7QUErQmxCLElBQU0sOEJBQThCO0FBR3BDLElBQU0sMEJBQTJFO0FBQUEsRUFDdEYsRUFBRSxPQUFPLElBQUksT0FBTyxtQkFBbUI7QUFBQSxFQUN2QyxFQUFFLE9BQU8sSUFBSSxPQUFPLG1CQUFtQjtBQUFBLEVBQ3ZDLEVBQUUsT0FBTyxJQUFJLE9BQU8sZUFBZTtBQUFBLEVBQ25DLEVBQUUsT0FBTyxLQUFLLE9BQU8sa0JBQWtCO0FBQUEsRUFDdkMsRUFBRSxPQUFPLEdBQUcsT0FBTywwQkFBMEI7QUFDL0M7QUFFTyxTQUFTLG9CQUF5QztBQUN2RCxTQUFPO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxVQUFVO0FBQUEsSUFDVixZQUFZO0FBQUEsSUFDWixVQUFVO0FBQUEsTUFDUixtQkFBbUI7QUFBQSxNQUNuQixjQUFjO0FBQUEsSUFDaEI7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLG9CQUFvQixLQUFtQztBQWxFdkU7QUFtRUUsUUFBTSxPQUFPLGtCQUFrQjtBQUMvQixNQUFJLE9BQU8sUUFBUSxZQUFZLFFBQVEsS0FBTSxRQUFPO0FBQ3BELFFBQU0sU0FBUztBQUNmLFNBQU87QUFBQSxJQUNMLEtBQUssT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFBQSxJQUNuRCxPQUFPLE9BQU8sT0FBTyxVQUFVLFdBQVcsT0FBTyxRQUFRO0FBQUEsSUFDekQsVUFBVSxPQUFPLE9BQU8sYUFBYSxXQUFXLE9BQU8sV0FBVztBQUFBLElBQ2xFLFlBQVksT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWE7QUFBQSxJQUN4RSxVQUFVO0FBQUEsTUFDUixtQkFDRSxTQUFPLFlBQU8sYUFBUCxtQkFBaUIsdUJBQXNCLFlBQVksT0FBTyxTQUFTLHFCQUFxQixJQUMzRixLQUFLLE1BQU0sT0FBTyxTQUFTLGlCQUFpQixJQUM1QztBQUFBLE1BQ04sZ0JBQWMsWUFBTyxhQUFQLG1CQUFpQixrQkFBaUI7QUFBQSxJQUNsRDtBQUFBLEVBQ0Y7QUFDRjtBQUdPLFNBQVMsU0FBUyxNQUFvQztBQUMzRCxTQUFPLEtBQUssUUFBUSxNQUFNLEtBQUssVUFBVSxNQUFNLEtBQUssYUFBYTtBQUNuRTtBQUdPLFNBQVMsbUJBQXlDO0FBQ3ZELFNBQU8seUJBQVMsY0FBYyxXQUFXO0FBQzNDO0FBR08sU0FBUyxvQkFBNEI7QUFDMUMsTUFBSSx5QkFBUyxhQUFhO0FBQ3hCLFFBQUkseUJBQVMsU0FBVSxRQUFPO0FBQzlCLFFBQUkseUJBQVMsYUFBYyxRQUFPO0FBQ2xDLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUOzs7QUM5Rk8sSUFBTSxpQkFBTixjQUE2QixNQUFNO0FBQUEsRUFDeEMsWUFDRSxTQUNTLFFBQ1Q7QUFDQSxVQUFNLE9BQU87QUFGSjtBQUdULFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQUdPLElBQU0sb0JBQU4sY0FBZ0MsTUFBTTtBQUFBLEVBQzNDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBR08sSUFBTSx1QkFBTixjQUFtQyxNQUFNO0FBQUEsRUFDOUMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFtQk8sU0FBUyxtQkFBbUIsT0FBdUI7QUFDeEQsTUFBSSxZQUFZLE1BQU0sS0FBSztBQUMzQixNQUFJLGNBQWMsR0FBSSxPQUFNLElBQUksZUFBZSxxQkFBcUI7QUFDcEUsTUFBSSxDQUFDLGdDQUFnQyxLQUFLLFNBQVMsRUFBRyxhQUFZLFdBQVcsU0FBUztBQUN0RixNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsSUFBSSxJQUFJLFNBQVMsRUFBRTtBQUFBLEVBQzlCLFNBQVE7QUFDTixVQUFNLElBQUksZUFBZSx1QkFBdUIsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDekU7QUFDQSxNQUFJLENBQUMsT0FBTyxXQUFXLFNBQVMsS0FBSyxDQUFDLE9BQU8sV0FBVyxVQUFVLEdBQUc7QUFDbkUsVUFBTSxJQUFJLGVBQWUsbUNBQW1DLE1BQU0sRUFBRTtBQUFBLEVBQ3RFO0FBQ0EsU0FBTztBQUNUO0FBR0EsZUFBc0IsWUFDcEIsUUFDQSxXQUNxQjtBQUNyQixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxVQUFVLEdBQUcsTUFBTSxTQUFTO0FBQUEsRUFDL0MsU0FBUyxPQUFPO0FBQ2QsV0FBTztBQUFBLE1BQ0wsV0FBVztBQUFBLE1BQ1gsU0FBUztBQUFBLE1BQ1QsUUFBUSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQUEsSUFDL0Q7QUFBQSxFQUNGO0FBQ0EsTUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixXQUFPLEVBQUUsV0FBVyxPQUFPLFNBQVMsT0FBTyxRQUFRLFFBQVEsU0FBUyxNQUFNLEdBQUc7QUFBQSxFQUMvRTtBQUNBLFFBQU0sT0FBUSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEVBQUU7QUFDcEQsU0FBTyxFQUFFLFdBQVcsTUFBTSxTQUFTLEtBQUssWUFBWSxLQUFLO0FBQzNEO0FBZUEsZUFBc0IsWUFBWSxRQUFxRDtBQUNyRixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxPQUFPLFVBQVUsR0FBRyxPQUFPLE1BQU0sU0FBUztBQUFBLE1BQ3pELFFBQVE7QUFBQSxNQUNSLFNBQVMsRUFBRSxnQkFBZ0IsbUJBQW1CO0FBQUEsTUFDOUMsTUFBTSxLQUFLLFVBQVU7QUFBQSxRQUNuQixNQUFNLE9BQU87QUFBQSxRQUNiLFlBQVksT0FBTztBQUFBLFFBQ25CLFlBQVksT0FBTztBQUFBLE1BQ3JCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNILFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSTtBQUFBLE1BQ1IsaUNBQWlDLE9BQU8sTUFBTSxLQUM1QyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQ3ZEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFVBQVUsTUFBTSxTQUFTLEtBQUssRUFBRSxNQUFNLE1BQU0sRUFBRSxHQUFHLEtBQUs7QUFDNUQsTUFBSSxTQUFTLFdBQVcsS0FBSztBQUMzQixVQUFNLElBQUkscUJBQXFCLHNDQUFzQztBQUFBLEVBQ3ZFO0FBQ0EsTUFBSSxTQUFTLFdBQVcsT0FBTyxTQUFTLFdBQVcsS0FBSztBQUN0RCxVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFFRjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLENBQUMsU0FBUyxJQUFJO0FBQ2hCLFVBQU0sSUFBSTtBQUFBLE1BQ1Isd0JBQXdCLFNBQVMsTUFBTSxJQUFJLE9BQU8sTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUs7QUFBQSxNQUN2RSxTQUFTO0FBQUEsSUFDWDtBQUFBLEVBQ0Y7QUFDQSxNQUFJO0FBQ0osTUFBSTtBQUNGLFdBQU8sS0FBSyxNQUFNLE1BQU07QUFBQSxFQUMxQixTQUFRO0FBQ04sVUFBTSxJQUFJLGVBQWUsOEJBQThCLFNBQVMsTUFBTTtBQUFBLEVBQ3hFO0FBQ0EsTUFBSSxPQUFPLEtBQUssVUFBVSxZQUFZLE9BQU8sS0FBSyxhQUFhLFVBQVU7QUFDdkUsVUFBTSxJQUFJLGVBQWUsNENBQTRDLFNBQVMsTUFBTTtBQUFBLEVBQ3RGO0FBQ0EsU0FBTyxFQUFFLE9BQU8sS0FBSyxPQUFPLFVBQVUsS0FBSyxTQUFTO0FBQ3REOzs7QUNuSE8sU0FBUyxrQkFBa0IsS0FBcUI7QUFDckQsU0FBTztBQUFBLElBQ0wsaUJBQWlCLEdBQUc7QUFBQSxJQUNwQjtBQUFBLElBQ0EsV0FBVyxHQUFHO0FBQUEsSUFDZDtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBTUEsZUFBc0IsZUFBZSxRQUE4QztBQWpEbkY7QUFrREUsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLG1CQUFtQixPQUFPLEdBQUc7QUFBQSxFQUN4QyxTQUFRO0FBQ04sV0FBTyxFQUFFLFFBQVEsZUFBZSxPQUFPLE9BQU8sSUFBSTtBQUFBLEVBQ3BEO0FBRUEsUUFBTSxTQUFTLE1BQU0sWUFBWSxRQUFRLE9BQU8sU0FBUztBQUN6RCxNQUFJLENBQUMsT0FBTyxXQUFXO0FBQ3JCLFdBQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLEtBQUs7QUFBQSxNQUNMLFFBQ0UsSUFBRyxZQUFPLFdBQVAsWUFBaUIsZUFBZTtBQUFBLElBRXZDO0FBQUEsRUFDRjtBQUNBLE1BQUksQ0FBQyxPQUFPLFNBQVM7QUFDbkIsV0FBTyxFQUFFLFFBQVEsYUFBYSxLQUFLLFFBQVEsVUFBVSxrQkFBa0IsTUFBTSxFQUFFO0FBQUEsRUFDakY7QUFFQSxNQUFJO0FBQ0YsVUFBTSxjQUFjLE1BQU0sWUFBWTtBQUFBLE1BQ3BDO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLFlBQVksT0FBTztBQUFBLE1BQ25CLFlBQVksT0FBTztBQUFBLE1BQ25CLFdBQVcsT0FBTztBQUFBLElBQ3BCLENBQUM7QUFDRCxXQUFPLEVBQUUsUUFBUSxVQUFVLEtBQUssUUFBUSxHQUFHLFlBQVk7QUFBQSxFQUN6RCxTQUFTLE9BQU87QUFDZCxRQUFJLGlCQUFpQixzQkFBc0I7QUFDekMsYUFBTyxFQUFFLFFBQVEsYUFBYSxLQUFLLFFBQVEsVUFBVSxrQkFBa0IsTUFBTSxFQUFFO0FBQUEsSUFDakY7QUFDQSxRQUFJLGlCQUFpQixtQkFBbUI7QUFDdEMsYUFBTyxFQUFFLFFBQVEsWUFBWSxLQUFLLFFBQVEsUUFBUSxNQUFNLFFBQVE7QUFBQSxJQUNsRTtBQUNBLFVBQU0sU0FBUyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQ3BFLFdBQU8sRUFBRSxRQUFRLFlBQVksS0FBSyxRQUFRLE9BQU87QUFBQSxFQUNuRDtBQUNGO0FBR08sU0FBUyxtQkFBbUIsU0FBOEI7QUFDL0QsVUFBUSxRQUFRLFFBQVE7QUFBQSxJQUN0QixLQUFLO0FBQ0gsYUFBTyxlQUFlLFFBQVEsR0FBRztBQUFBLElBQ25DLEtBQUs7QUFDSCxhQUFPLFFBQVE7QUFBQSxJQUNqQixLQUFLO0FBQ0gsYUFBTywrQkFBK0IsUUFBUSxNQUFNO0FBQUEsSUFDdEQsS0FBSztBQUNILGFBQU8sbUJBQW1CLFFBQVEsTUFBTTtBQUFBLElBQzFDLEtBQUs7QUFDSCxhQUFPLHlDQUF5QyxLQUFLLFVBQVUsUUFBUSxLQUFLLENBQUM7QUFBQSxFQUNqRjtBQUNGOzs7QUM1RkEsSUFBQUMsbUJBQXVCO0FBR2hCLElBQU0sa0JBQWtCO0FBdUJ4QixTQUFTLGtCQUFrQixRQUFzRDtBQUN0RixRQUFNLE1BQU0sVUFBVSxRQUFRLEtBQUs7QUFDbkMsUUFBTSxPQUFPLFVBQVUsUUFBUSxNQUFNO0FBQ3JDLE1BQUksUUFBUSxNQUFNLFNBQVMsSUFBSTtBQUM3QixXQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sd0JBQXdCO0FBQUEsRUFDckQ7QUFDQSxNQUFJLFFBQVEsR0FBSSxRQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sb0RBQStDO0FBQzFGLE1BQUksU0FBUyxHQUFJLFFBQU8sRUFBRSxJQUFJLE9BQU8sT0FBTyx1REFBa0Q7QUFDOUYsU0FBTyxFQUFFLElBQUksTUFBTSxNQUFNLEVBQUUsS0FBSyxLQUFLLEVBQUU7QUFDekM7QUFFQSxTQUFTLFVBQVUsUUFBaUMsS0FBcUI7QUFDdkUsUUFBTSxRQUFRLE9BQU8sR0FBRztBQUN4QixNQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU8sT0FBTyxLQUFLO0FBQ2xELE1BQUksT0FBTyxVQUFVLFNBQVUsUUFBTztBQUN0QyxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBRzNCLE1BQUksUUFBUSxTQUFTLEdBQUcsR0FBRztBQUN6QixRQUFJO0FBQ0YsYUFBTyxtQkFBbUIsT0FBTztBQUFBLElBQ25DLFNBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFPTyxTQUFTLDRCQUNkLFVBQ0EsUUFDTTtBQUNOLFFBQU0sVUFBMkIsQ0FBQyxXQUFXO0FBQzNDLFVBQU0sU0FBUyxrQkFBa0IsTUFBTTtBQUN2QyxRQUFJLENBQUMsT0FBTyxJQUFJO0FBRWQsVUFBSSxPQUFPLFVBQVUseUJBQXlCO0FBQzVDLFlBQUksd0JBQU8sd0JBQXdCLE9BQU8sS0FBSyxFQUFFO0FBQUEsTUFDbkQ7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLE9BQU8sT0FBTyxJQUFJLEVBQUUsTUFBTSxDQUFDLFVBQW1CO0FBQ2pELGNBQVEsTUFBTSxrQ0FBa0MsS0FBSztBQUNyRCxVQUFJLHdCQUFPLHdFQUFtRTtBQUFBLElBQ2hGLENBQUM7QUFBQSxFQUNIO0FBQ0EsV0FBUyxpQkFBaUIsT0FBTztBQUVqQyxXQUFTLEdBQUcsZUFBZSxTQUFTLE9BQU87QUFDN0M7OztBQzFFTyxJQUFNLDRCQUE0QjtBQUNsQyxJQUFNLDJCQUEyQjtBQU1qQyxTQUFTLGVBQWUsU0FBaUIsVUFBMEIsQ0FBQyxHQUFXO0FBM0J0RjtBQTRCRSxRQUFNLFFBQU8sYUFBUSxXQUFSLFlBQWtCO0FBQy9CLFFBQU0sT0FBTSxhQUFRLFVBQVIsWUFBaUI7QUFDN0IsUUFBTSxVQUFTLGFBQVEsV0FBUixZQUFrQjtBQUNqQyxRQUFNLFVBQVMsYUFBUSxXQUFSLFlBQWtCLEtBQUs7QUFDdEMsUUFBTSxjQUFjLEtBQUssSUFBSSxLQUFLLE9BQU8sS0FBSyxPQUFPO0FBQ3JELFFBQU0sU0FBUyxLQUFLLE9BQU8sSUFBSSxJQUFJLEtBQUs7QUFDeEMsU0FBTyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssY0FBYyxNQUFNLENBQUMsQ0FBQztBQUN0RTtBQVNPLElBQU0sc0JBQU4sTUFBMEI7QUFBQSxFQUsvQixZQUFZLFVBQTBCLENBQUMsR0FBRztBQUoxQyx3QkFBUSxXQUFVO0FBQ2xCLHdCQUFRLGFBQVk7QUFDcEIsd0JBQWlCO0FBR2YsU0FBSyxVQUFVO0FBQUEsRUFDakI7QUFBQTtBQUFBLEVBR0EsU0FBUyxPQUEyQztBQUNsRCxRQUFJLFVBQVUsZ0JBQWdCO0FBQzVCLFdBQUssVUFBVTtBQUNmLFdBQUssWUFBWTtBQUNqQixhQUFPLEVBQUUsUUFBUSxPQUFPO0FBQUEsSUFDMUI7QUFDQSxRQUFJLEtBQUssVUFBVyxRQUFPLEVBQUUsUUFBUSxPQUFPO0FBQzVDLFdBQU8sRUFBRSxRQUFRLGFBQWEsU0FBUyxlQUFlLEtBQUssU0FBUyxLQUFLLE9BQU8sRUFBRTtBQUFBLEVBQ3BGO0FBQUE7QUFBQSxFQUdBLGVBQXFCO0FBQ25CLFNBQUssV0FBVztBQUNoQixTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBO0FBQUEsRUFHQSxVQUFnQjtBQUNkLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUE7QUFBQSxFQUdBLElBQUksV0FBbUI7QUFDckIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUNGOzs7QUN0RUEsSUFBQUMsbUJBQXlEOzs7QUNxQmxELFNBQVMsWUFBWSxXQUEyQjtBQUNyRCxRQUFNLFVBQVUsS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLFlBQVksR0FBSSxDQUFDO0FBQ3hELE1BQUksVUFBVSxHQUFJLFFBQU8sR0FBRyxPQUFPO0FBQ25DLFFBQU0sVUFBVSxLQUFLLE1BQU0sVUFBVSxFQUFFO0FBQ3ZDLE1BQUksVUFBVSxHQUFJLFFBQU8sR0FBRyxPQUFPO0FBQ25DLFNBQU8sR0FBRyxLQUFLLE1BQU0sVUFBVSxFQUFFLENBQUM7QUFDcEM7QUFHTyxTQUFTLGNBQWMsUUFBMEIsS0FBcUI7QUFDM0UsVUFBUSxPQUFPLE9BQU87QUFBQSxJQUNwQixLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxVQUFJLE9BQU8sVUFBVSxTQUFTLEVBQUcsUUFBTyx5QkFBb0IsT0FBTyxVQUFVLE1BQU07QUFDbkYsVUFBSSxPQUFPLGVBQWUsS0FBTSxRQUFPO0FBQ3ZDLGFBQU8sY0FBUyxZQUFZLE1BQU0sT0FBTyxVQUFVLENBQUM7QUFBQSxJQUN0RCxLQUFLO0FBQ0gsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQUdPLFNBQVMsaUJBQWlCLFFBQTBCLFNBQXdCLEtBQXFCO0FBQ3RHLFFBQU0sYUFBd0Q7QUFBQSxJQUM1RCxNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixTQUFTO0FBQUEsSUFDVCxNQUFNO0FBQUEsSUFDTixjQUFjO0FBQUEsRUFDaEI7QUFDQSxRQUFNLFFBQVEsQ0FBQywrQkFBMEIsV0FBVyxPQUFPLEtBQUssQ0FBQyxFQUFFO0FBQ25FLE1BQUksUUFBUSxRQUFRLEdBQUksT0FBTSxLQUFLLFdBQVcsUUFBUSxHQUFHLEVBQUU7QUFDM0QsTUFBSSxRQUFRLGVBQWUsR0FBSSxPQUFNLEtBQUssV0FBVyxRQUFRLFVBQVUsRUFBRTtBQUN6RSxRQUFNO0FBQUEsSUFDSixPQUFPLGVBQWUsT0FDbEIscUJBQ0EsY0FBYyxZQUFZLE1BQU0sT0FBTyxVQUFVLENBQUM7QUFBQSxFQUN4RDtBQUNBLFFBQU0sS0FBSyxvQkFBb0IsT0FBTyxPQUFPLEVBQUU7QUFDL0MsUUFBTSxLQUFLLGNBQWMsT0FBTyxVQUFVLE1BQU0sRUFBRTtBQUNsRCxNQUFJLE9BQU8sVUFBVSxTQUFTLEdBQUc7QUFDL0IsVUFBTSxLQUFLLG9CQUFvQixPQUFPLFVBQVUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRTtBQUFBLEVBQ2pGO0FBQ0EsTUFBSSxRQUFRLFNBQVMsVUFBYSxRQUFRLFNBQVMsR0FBSSxPQUFNLEtBQUssUUFBUSxJQUFJO0FBQzlFLFNBQU8sTUFBTSxLQUFLLElBQUk7QUFDeEI7QUFHTyxTQUFTLGVBQWUsUUFBa0M7QUFDL0QsTUFBSSxPQUFPLFVBQVUsZUFBZ0IsUUFBTztBQUM1QyxNQUFJLE9BQU8sVUFBVSxTQUFTLEVBQUcsUUFBTztBQUN4QyxTQUFPO0FBQ1Q7QUFNTyxJQUFNLHNCQUFOLE1BQU0sb0JBQW1CO0FBQUEsRUFLOUIsWUFBNkIsTUFBc0I7QUFBdEI7QUFBQSxFQUF1QjtBQUFBLEVBRXBELE9BQU8sUUFBMEIsU0FBd0IsS0FBbUI7QUFuRzlFO0FBb0dJLFNBQUssS0FBSyxjQUFjLGNBQWMsUUFBUSxHQUFHO0FBQ2pELHFCQUFLLE1BQUssYUFBViw0QkFBcUIsb0JBQW1CO0FBQ3hDLFVBQU0sV0FBVyxlQUFlLE1BQU07QUFDdEMsZUFBVyxPQUFPLG9CQUFtQixrQkFBa0I7QUFDckQsVUFBSSxRQUFRLFNBQVUsa0JBQUssTUFBSyxhQUFWLDRCQUFxQjtBQUFBLFVBQ3RDLGtCQUFLLE1BQUssZ0JBQVYsNEJBQXdCO0FBQUEsSUFDL0I7QUFDQSxxQkFBSyxNQUFLLGlCQUFWLDRCQUF5QixTQUFTLGlCQUFpQixRQUFRLFNBQVMsR0FBRztBQUFBLEVBQ3pFO0FBQ0Y7QUFBQTtBQWZFLGNBRlcscUJBRWEsY0FBYTtBQUNyQyxjQUhXLHFCQUdhLG9CQUFtQixDQUFDLFlBQVksV0FBVztBQUg5RCxJQUFNLHFCQUFOOzs7QURsRUEsSUFBTSxhQUNYO0FBSUssU0FBUyxpQkFBdUI7QUFDckMsTUFBSSxPQUFPLFdBQVcsWUFBYTtBQUNuQyxTQUFPLEtBQUssWUFBWSxRQUFRO0FBQ2xDO0FBR08sSUFBTSxlQUFOLGNBQTJCLHVCQUFNO0FBQUEsRUFDdEMsWUFDRSxLQUNpQixTQU1qQjtBQUNBLFVBQU0sR0FBRztBQVBRO0FBQUEsRUFRbkI7QUFBQSxFQUVTLFNBQWU7QUFDdEIsUUFBSSx5QkFBUSxLQUFLLFNBQVMsRUFBRSxRQUFRLEtBQUssUUFBUSxLQUFLLEVBQUUsUUFBUSxLQUFLLFFBQVEsSUFBSTtBQUNqRixRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQU8sY0FBYyxRQUFRLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDM0Q7QUFDQSxRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQ0csT0FBTyxFQUNQLGNBQWMsS0FBSyxRQUFRLFdBQVcsRUFDdEMsUUFBUSxZQUFZO0FBQ25CLGFBQUssTUFBTTtBQUNYLGNBQU0sS0FBSyxRQUFRLFVBQVU7QUFBQSxNQUMvQixDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFDRjtBQUVPLElBQU0sc0JBQU4sY0FBa0Msa0NBQWlCO0FBQUEsRUFReEQsWUFBWSxLQUFVLFFBQXlCO0FBQzdDLFVBQU0sS0FBSyxNQUFNO0FBUm5CLHdCQUFpQjtBQUVqQjtBQUFBLHdCQUFRLGVBQWM7QUFDdEIsd0JBQVEsZUFBOEI7QUFDdEMsd0JBQVEsaUJBQWdDO0FBQ3hDLHdCQUFRLGlCQUF1RDtBQUk3RCxTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBRVMsVUFBZ0I7QUFDdkIsU0FBSyxZQUFZO0FBQ2pCLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsZ0JBQVksTUFBTTtBQUNsQixTQUFLLGNBQWM7QUFDbkIsU0FBSyxnQkFBZ0I7QUFFckIsU0FBSyx3QkFBd0I7QUFDN0IsUUFBSSxLQUFLLE9BQU8sUUFBUTtBQUN0QixXQUFLLG9CQUFvQjtBQUFBLElBQzNCLE9BQU87QUFDTCxXQUFLLHFCQUFxQjtBQUFBLElBQzVCO0FBQ0EsU0FBSyxhQUFhO0FBQUEsRUFDcEI7QUFBQSxFQUVTLE9BQWE7QUFDcEIsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQTtBQUFBLEVBSVEsMEJBQWdDO0FBQ3RDLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsWUFBWSxFQUNwQjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0M7QUFBQSxNQUFRLENBQUMsU0FDUixLQUNHLGVBQWUsZ0NBQWdDLEVBQy9DLFNBQVMsS0FBSyxPQUFPLEtBQUssR0FBRyxFQUM3QixTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sS0FBSyxNQUFNLE1BQU0sS0FBSztBQUNsQyxjQUFNLEtBQUssT0FBTyxlQUFlO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxhQUFhLEVBQ3JCLFFBQVEsd0VBQXdFLEVBQ2hGO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLGtCQUFrQixDQUFDLEVBQ2xDLFNBQVMsS0FBSyxPQUFPLEtBQUssVUFBVSxFQUNwQyxTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sS0FBSyxhQUFhLE1BQU0sS0FBSztBQUN6QyxjQUFNLEtBQUssT0FBTyxlQUFlO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKO0FBQUEsRUFFUSx1QkFBNkI7QUFDbkMsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxjQUFjLEVBQ3RCLFFBQVEsNkdBQXdHLEVBQ2hIO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLFdBQVcsRUFDMUIsU0FBUyxDQUFDLFVBQVU7QUFDbkIsYUFBSyxjQUFjLE1BQU0sS0FBSztBQUFBLE1BQ2hDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQUU7QUFBQSxNQUFVLENBQUMsV0FDbEMsT0FDRyxPQUFPLEVBQ1AsY0FBYyxpQkFBaUIsRUFDL0IsUUFBUSxZQUFZO0FBQ25CLGVBQU8sWUFBWSxJQUFJO0FBQ3ZCLFlBQUk7QUFDRixnQkFBTSxVQUFVLE1BQU0sS0FBSyxPQUFPLGlCQUFpQixLQUFLLFdBQVc7QUFDbkUsZUFBSyxZQUFZLE9BQU87QUFBQSxRQUMxQixVQUFFO0FBQ0EsaUJBQU8sWUFBWSxLQUFLO0FBQUEsUUFDMUI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNMO0FBRUEsU0FBSyxjQUFjLElBQUkseUJBQVEsV0FBVyxFQUN2QyxRQUFRLGlCQUFpQixFQUN6QixTQUFTLG1CQUFtQixFQUM1QjtBQUFBLE1BQ0M7QUFBQSxRQUNFO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRixFQUFFLEtBQUssSUFBSTtBQUFBLElBQ2IsRUFDQztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxvQkFBb0IsRUFBRSxRQUFRLE1BQU0sZUFBZSxDQUFDO0FBQUEsSUFDM0U7QUFBQSxFQUNKO0FBQUEsRUFFUSxzQkFBNEI7QUFDbEMsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixVQUFNLE9BQU8sS0FBSyxPQUFPO0FBRXpCLFNBQUssZ0JBQWdCLElBQUkseUJBQVEsV0FBVyxFQUN6QyxRQUFRLFFBQVEsRUFDaEIsU0FBUyxvQkFBb0IsRUFDN0IsUUFBUSxLQUFLLFdBQVcsQ0FBQztBQUU1QixRQUFJLHlCQUFRLFdBQVcsRUFBRTtBQUFBLE1BQVUsQ0FBQyxXQUNsQyxPQUFPLGNBQWMsVUFBVSxFQUFFLFFBQVEsWUFBWTtBQUNuRCxlQUFPLFlBQVksSUFBSTtBQUN2QixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxPQUFPLFFBQVE7QUFBQSxRQUM1QixVQUFFO0FBQ0EsaUJBQU8sWUFBWSxLQUFLO0FBQ3hCLGVBQUssY0FBYztBQUFBLFFBQ3JCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGlCQUFpQixFQUN6QjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0MsWUFBWSxDQUFDLGFBQWE7QUFDekIsaUJBQVcsVUFBVSx5QkFBeUI7QUFDNUMsaUJBQVMsVUFBVSxPQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sS0FBSztBQUFBLE1BQ3ZEO0FBQ0EsZUFBUyxTQUFTLE9BQU8sS0FBSyxTQUFTLGlCQUFpQixDQUFDO0FBQ3pELGVBQVMsU0FBUyxPQUFPLFVBQVU7QUFDakMsY0FBTSxLQUFLLE9BQU8sb0JBQW9CLE9BQU8sS0FBSyxDQUFDO0FBQUEsTUFDckQsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUVILFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHdCQUF3QixFQUNoQztBQUFBLE1BQ0M7QUFBQSxJQUVGLEVBQ0M7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxTQUFTLFlBQVksRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNwRSxjQUFNLEtBQUssT0FBTyxrQkFBa0IsS0FBSztBQUFBLE1BQzNDLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQUU7QUFBQSxNQUFVLENBQUMsV0FDbEMsT0FBTyxjQUFjLG1CQUFtQixFQUFFLFFBQVEsTUFBTTtBQUN0RCxZQUFJLGFBQWEsS0FBSyxLQUFLO0FBQUEsVUFDekIsT0FBTztBQUFBLFVBQ1AsTUFBTTtBQUFBLFVBQ04sYUFBYTtBQUFBLFVBQ2IsV0FBVyxZQUFZO0FBQ3JCLGtCQUFNLEtBQUssT0FBTyxPQUFPO0FBQ3pCLGlCQUFLLFFBQVE7QUFBQSxVQUNmO0FBQUEsUUFDRixDQUFDLEVBQUUsS0FBSztBQUFBLE1BQ1YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLGFBQXFCO0FBbFAvQjtBQW1QSSxVQUFNLE9BQTRCLEtBQUssT0FBTztBQUM5QyxVQUFNLFVBQVMsVUFBSyxPQUFPLFdBQVosbUJBQW9CO0FBQ25DLFFBQUksV0FBVyxRQUFXO0FBQ3hCLGFBQU8sYUFBYSxLQUFLLEdBQUcsWUFBWSxLQUFLLGNBQWMsS0FBSyxRQUFRO0FBQUEsSUFDMUU7QUFDQSxVQUFNLFdBQ0osT0FBTyxlQUFlLE9BQ2xCLFVBQ0EsR0FBRyxZQUFZLEtBQUssSUFBSSxJQUFJLE9BQU8sVUFBVSxDQUFDO0FBQ3BELFVBQU0sUUFBUSxPQUFPLFVBQVUsU0FBUyxjQUFjLE9BQU87QUFDN0QsV0FBTztBQUFBLE1BQ0wsVUFBVSxLQUFLO0FBQUEsTUFDZixXQUFXLEtBQUssR0FBRztBQUFBLE1BQ25CLGNBQWMsUUFBUTtBQUFBLE1BQ3RCLG9CQUFvQixPQUFPLE9BQU87QUFBQSxNQUNsQyxjQUFjLE9BQU8sVUFBVSxNQUFNLEdBQUcsT0FBTyxVQUFVLFNBQVMsSUFBSSxtREFBbUQsRUFBRTtBQUFBLElBQzdILEVBQUUsS0FBSyxJQUFJO0FBQUEsRUFDYjtBQUFBLEVBRVEsZ0JBQXNCO0FBdFFoQztBQXVRSSxlQUFLLGtCQUFMLG1CQUFvQixRQUFRLEtBQUssV0FBVztBQUFBLEVBQzlDO0FBQUE7QUFBQSxFQUdRLFlBQVksU0FBNEI7QUFDOUMsUUFBSSxRQUFRLFdBQVcsVUFBVTtBQUMvQixVQUFJLHdCQUFPLG1CQUFtQixPQUFPLENBQUM7QUFDdEMsV0FBSyxRQUFRO0FBQ2I7QUFBQSxJQUNGO0FBQ0EsVUFBTSxVQUFVLG1CQUFtQixPQUFPO0FBQzFDLFFBQUksd0JBQU8sU0FBUyxHQUFLO0FBQ3pCLFFBQUksS0FBSyxnQkFBZ0IsS0FBTSxNQUFLLFlBQVksUUFBUSxPQUFPO0FBQUEsRUFDakU7QUFBQTtBQUFBO0FBQUEsRUFLUSxlQUFxQjtBQUMzQixTQUFLLFlBQVk7QUFDakIsVUFBTSxTQUFTLFlBQVksTUFBTSxLQUFLLGNBQWMsR0FBRyxHQUFJO0FBQzNELFNBQUssZ0JBQWdCO0FBR3JCLFNBQUssT0FBTyxpQkFBaUIsTUFBMkI7QUFBQSxFQUMxRDtBQUFBLEVBRVEsY0FBb0I7QUFDMUIsUUFBSSxLQUFLLGtCQUFrQixNQUFNO0FBQy9CLG9CQUFjLEtBQUssYUFBYTtBQUNoQyxXQUFLLGdCQUFnQjtBQUFBLElBQ3ZCO0FBQUEsRUFDRjtBQUNGOzs7QUU1UE8sU0FBUyxlQUFlLFNBQWlCLE9BQWUsT0FBTyxPQUFlO0FBQ25GLFFBQU0sTUFBTSxJQUFJLElBQUksT0FBTztBQUMzQixNQUFJLElBQUksYUFBYSxRQUFTLEtBQUksV0FBVztBQUFBLFdBQ3BDLElBQUksYUFBYSxTQUFVLEtBQUksV0FBVztBQUFBLFdBQzFDLElBQUksYUFBYSxTQUFTLElBQUksYUFBYSxRQUFRO0FBQzFELFVBQU0sSUFBSSxhQUFhLGtEQUFrRCxJQUFJLFFBQVEsRUFBRTtBQUFBLEVBQ3pGO0FBQ0EsTUFBSSxXQUFXO0FBQ2YsTUFBSSxTQUFTO0FBQ2IsTUFBSSxhQUFhLElBQUksU0FBUyxLQUFLO0FBQ25DLFNBQU8sSUFBSSxTQUFTO0FBQ3RCO0FBRUEsU0FBUyx3QkFBd0IsS0FBNEI7QUFDM0QsUUFBTSxZQUFhLFdBQXVDO0FBQzFELE1BQUksT0FBTyxjQUFjLFlBQVk7QUFDbkMsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBR0Y7QUFBQSxFQUNGO0FBQ0EsU0FBTyxJQUFLLFVBQWlELEdBQUc7QUFDbEU7QUFFTyxJQUFNLHFCQUFOLE1BQThDO0FBQUEsRUFVbkQsWUFBWSxTQUFvQztBQVRoRCx3QkFBaUI7QUFDakIsd0JBQVEsbUJBQXVEO0FBQy9ELHdCQUFRLGlCQUF3RDtBQUNoRSx3QkFBUSxRQUFPO0FBQ2Ysd0JBQVEsVUFBUztBQUNqQix3QkFBUSxpQkFBZ0I7QUFDeEIsd0JBQWlCLGFBQXNCLENBQUM7QUFDeEMsd0JBQVE7QUE3RVY7QUFnRkksVUFBTSxXQUFVLGFBQVEsY0FBUixZQUFxQjtBQUNyQyxVQUFNLE1BQU0sZUFBZSxRQUFRLEtBQUssUUFBUSxRQUFPLGFBQVEsU0FBUixZQUFnQixLQUFLO0FBQzVFLFNBQUssU0FBUyxRQUFRLEdBQUc7QUFFekIsU0FBSyxPQUFPLGlCQUFpQixRQUFRLE1BQU07QUFDekMsV0FBSyxPQUFPO0FBQ1osWUFBTSxTQUFTLENBQUMsR0FBRyxLQUFLLFNBQVM7QUFDakMsV0FBSyxVQUFVLFNBQVM7QUFDeEIsaUJBQVcsU0FBUyxPQUFRLE1BQUssT0FBTyxLQUFLLEtBQUs7QUFBQSxJQUNwRCxDQUFDO0FBRUQsU0FBSyxPQUFPLGlCQUFpQixXQUFXLENBQUMsVUFBVTtBQTNGdkQsVUFBQUM7QUE0Rk0sVUFBSSxPQUFPLE1BQU0sU0FBUyxVQUFVO0FBQ2xDLGFBQUssS0FBSyxFQUFFLE1BQU0sTUFBTSxRQUFRLDZDQUE2QyxDQUFDO0FBQzlFO0FBQUEsTUFDRjtBQUNBLFVBQUk7QUFDSixVQUFJO0FBQ0Ysa0JBQVUsYUFBYSxNQUFNLElBQUk7QUFBQSxNQUNuQyxTQUFTLE9BQU87QUFDZCxhQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sUUFBUSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLEVBQUUsQ0FBQztBQUN4RjtBQUFBLE1BQ0Y7QUFDQSxPQUFBQSxNQUFBLEtBQUssb0JBQUwsZ0JBQUFBLElBQUEsV0FBdUI7QUFBQSxJQUN6QixDQUFDO0FBRUQsU0FBSyxPQUFPLGlCQUFpQixTQUFTLENBQUMsVUFBVTtBQUMvQyxXQUFLLFlBQ0gsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLFVBQVUsU0FBWSxPQUFPLEtBQUssSUFBSTtBQUFBLElBQ25GLENBQUM7QUFFRCxTQUFLLE9BQU8saUJBQWlCLFNBQVMsQ0FBQyxVQUFVO0FBQy9DLFdBQUssWUFBWTtBQUFBLFFBQ2YsTUFBTSxNQUFNO0FBQUEsUUFDWixRQUFRLE1BQU0sV0FBVyxVQUFhLE1BQU0sV0FBVyxLQUFLLE1BQU0sU0FBUyxLQUFLO0FBQUEsTUFDbEYsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLEtBQUssU0FBd0I7QUFDM0IsUUFBSSxLQUFLLE9BQVEsT0FBTSxJQUFJLGFBQWEsNEJBQTRCO0FBQ3BFLFVBQU0sUUFBUSxLQUFLLFVBQVUsT0FBTztBQUNwQyxRQUFJLEtBQUssTUFBTTtBQUNiLFdBQUssT0FBTyxLQUFLLEtBQUs7QUFDdEI7QUFBQSxJQUNGO0FBQ0EsU0FBSyxVQUFVLEtBQUssS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFFQSxVQUFVLFVBQTRDO0FBQ3BELFNBQUssa0JBQWtCO0FBQUEsRUFDekI7QUFBQSxFQUVBLFFBQVEsVUFBK0M7QUFDckQsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRUEsUUFBYztBQUNaLFFBQUksS0FBSyxPQUFRO0FBQ2pCLFNBQUssU0FBUztBQUNkLFNBQUssVUFBVSxTQUFTO0FBQ3hCLFFBQUk7QUFDRixXQUFLLE9BQU8sTUFBTSxLQUFNLGtCQUFrQjtBQUFBLElBQzVDLFNBQVE7QUFBQSxJQUVSO0FBRUEsU0FBSyxZQUFZLEVBQUUsTUFBTSxLQUFNLFFBQVEsbUJBQW1CLENBQUM7QUFBQSxFQUM3RDtBQUFBLEVBRVEsS0FBSyxRQUEyQjtBQXRKMUM7QUF1SkksU0FBSyxTQUFTO0FBQ2QsUUFBSTtBQUNGLFdBQUssT0FBTyxPQUFNLFlBQU8sU0FBUCxZQUFlLE9BQU0sWUFBTyxXQUFQLFlBQWlCLEVBQUU7QUFBQSxJQUM1RCxTQUFRO0FBQUEsSUFFUjtBQUNBLFNBQUssWUFBWSxNQUFNO0FBQUEsRUFDekI7QUFBQSxFQUVRLFlBQVksUUFBMkI7QUFoS2pEO0FBaUtJLFNBQUssT0FBTztBQUNaLFNBQUssU0FBUztBQUNkLFFBQUksS0FBSyxjQUFlO0FBQ3hCLFNBQUssZ0JBQWdCO0FBQ3JCLGVBQUssa0JBQUwsOEJBQXFCO0FBQUEsRUFDdkI7QUFDRjs7O0F2QjlIQSxJQUFNLDJCQUEyQjtBQUNqQyxJQUFNLHlCQUF5QjtBQUMvQixJQUFNLHNCQUFzQjtBQWNyQixJQUFNLGtCQUFOLGNBQThCLHdCQUFPO0FBQUEsRUF1QjFDLFlBQVksS0FBVSxVQUEwQixZQUE2QixDQUFDLEdBQUc7QUFDL0UsVUFBTSxLQUFLLFFBQVE7QUF2QnJCLGdDQUE0QixrQkFBa0I7QUFFOUM7QUFBQSxrQ0FBNEI7QUFFNUIsd0JBQWlCO0FBQ2pCLHdCQUFRLFdBQXVDO0FBQy9DLHdCQUFRLFVBQWlDO0FBQ3pDLHdCQUFRLGFBQXVDO0FBQy9DLHdCQUFRLGlCQUFvQztBQUM1Qyx3QkFBUSxjQUFpQztBQUN6Qyx3QkFBUSxrQkFBcUM7QUFDN0Msd0JBQVEsY0FBYSxJQUFJLG9CQUFvQjtBQUU3QztBQUFBLHdCQUFRLGNBQWE7QUFDckIsd0JBQVEsY0FBYTtBQUNyQix3QkFBaUIsV0FBc0I7QUFBQSxNQUNyQyxPQUFPLElBQUksU0FBb0IsUUFBUSxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBQUEsTUFDN0QsTUFBTSxJQUFJLFNBQW9CLFFBQVEsS0FBSyxTQUFTLEdBQUcsSUFBSTtBQUFBLE1BQzNELE1BQU0sSUFBSSxTQUFvQixRQUFRLEtBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxNQUMzRCxPQUFPLElBQUksU0FBb0IsUUFBUSxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBQUEsSUFDL0Q7QUFJRSxTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBLEVBRUEsSUFBWSxNQUFvQjtBQXJGbEM7QUFzRkksWUFBTyxVQUFLLFVBQVUsUUFBZixhQUF1QixNQUFNLEtBQUssSUFBSTtBQUFBLEVBQy9DO0FBQUEsRUFFQSxJQUFZLFlBQTBCO0FBekZ4QztBQTBGSSxZQUFPLFVBQUssVUFBVSxjQUFmLFlBQTRCO0FBQUEsRUFDckM7QUFBQSxFQUVBLElBQUksU0FBa0I7QUFDcEIsV0FBTyxTQUFTLEtBQUssSUFBSTtBQUFBLEVBQzNCO0FBQUEsRUFFQSxNQUFlLFNBQXdCO0FBQ3JDLFNBQUssT0FBTyxvQkFBb0IsTUFBTSxLQUFLLFNBQVMsQ0FBQztBQUNyRCxTQUFLLGNBQWMsSUFBSSxvQkFBb0IsS0FBSyxLQUFLLElBQUksQ0FBQztBQUMxRDtBQUFBLE1BQ0UsQ0FBQyxRQUFRLFlBQVksS0FBSyxnQ0FBZ0MsUUFBUSxPQUFPO0FBQUEsTUFDekUsQ0FBQyxTQUFTLEtBQUssbUJBQW1CLEtBQUssS0FBSyxLQUFLLElBQUk7QUFBQSxJQUN2RDtBQUdBLFNBQUssY0FBYyxLQUFLLElBQUksVUFBVSxHQUFHLHNCQUFzQixNQUFHO0FBMUd0RTtBQTBHeUUsd0JBQUssV0FBTCxtQkFBYTtBQUFBLEtBQU0sQ0FBQztBQUN6RixRQUFJLEtBQUssT0FBUSxPQUFNLEtBQUssVUFBVTtBQUFBLEVBQ3hDO0FBQUEsRUFFUyxXQUFpQjtBQUN4QixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBO0FBQUEsRUFJQSxNQUFNLGlCQUFnQztBQUNwQyxVQUFNLEtBQUssU0FBUyxLQUFLLElBQUk7QUFBQSxFQUMvQjtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQU0saUJBQWlCLE1BQW9DO0FBQ3pELFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsTUFBTSxlQUFlO0FBQUEsTUFDbkMsS0FBSyxLQUFLLEtBQUs7QUFBQSxNQUNmO0FBQUEsTUFDQTtBQUFBLE1BQ0EsWUFBWSxpQkFBaUI7QUFBQSxNQUM3QixXQUFXLEtBQUs7QUFBQSxJQUNsQixDQUFDO0FBQ0QsVUFBTSxLQUFLLGlCQUFpQixTQUFTLFVBQVU7QUFDL0MsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBR0EsTUFBYyxtQkFBbUIsS0FBYSxNQUE2QjtBQUN6RSxRQUFJLEtBQUssUUFBUTtBQUNmLFVBQUksdUJBQXVCLEdBQUcsTUFBTSx1QkFBdUIsS0FBSyxLQUFLLEdBQUcsR0FBRztBQUN6RSxZQUFJLHdCQUFPLDJEQUEyRDtBQUFBLE1BQ3hFLE9BQU87QUFDTCxZQUFJO0FBQUEsVUFDRjtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsTUFBTSxlQUFlO0FBQUEsTUFDbkM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsWUFBWSxpQkFBaUI7QUFBQSxNQUM3QixXQUFXLEtBQUs7QUFBQSxJQUNsQixDQUFDO0FBQ0QsVUFBTSxLQUFLLGlCQUFpQixTQUFTLFVBQVU7QUFBQSxFQUNqRDtBQUFBLEVBRUEsTUFBYyxpQkFBaUIsU0FBc0IsWUFBbUM7QUFDdEYsUUFBSSxRQUFRLFdBQVcsVUFBVTtBQUMvQixVQUFJLHdCQUFPLG1CQUFtQixPQUFPLEdBQUcsR0FBSztBQUM3QztBQUFBLElBQ0Y7QUFDQSxTQUFLLEtBQUssTUFBTSxRQUFRO0FBQ3hCLFNBQUssS0FBSyxRQUFRLFFBQVE7QUFDMUIsU0FBSyxLQUFLLFdBQVcsUUFBUTtBQUM3QixTQUFLLEtBQUssYUFBYTtBQUN2QixVQUFNLEtBQUssZUFBZTtBQUMxQixVQUFNLEtBQUssa0JBQWtCO0FBQzdCLFFBQUksd0JBQU8sbUJBQW1CLE9BQU8sQ0FBQztBQUN0QyxVQUFNLEtBQUssVUFBVTtBQUFBLEVBQ3ZCO0FBQUEsRUFFUSxvQkFBNEI7QUFDbEMsVUFBTSxRQUFRLEtBQUssS0FBSyxXQUFXLEtBQUs7QUFDeEMsV0FBTyxVQUFVLEtBQUssUUFBUSxrQkFBa0I7QUFBQSxFQUNsRDtBQUFBO0FBQUEsRUFHQSxNQUFjLG9CQUFtQztBQUMvQyxRQUFJLENBQUMsS0FBSyxPQUFRO0FBQ2xCLFVBQU0sVUFBVSxJQUFJLHVCQUF1QixFQUFFLFNBQVMsS0FBSyxJQUFJLE1BQU0sUUFBUSxDQUFDO0FBQzlFLFVBQU0sU0FBUztBQUFBLE1BQ2IsVUFBVSxLQUFLLEtBQUs7QUFBQSxNQUNwQixZQUFZLEtBQUssa0JBQWtCO0FBQUEsTUFDbkMsS0FBSyxLQUFLLEtBQUs7QUFBQSxNQUNmLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDckI7QUFDQSxRQUFJO0FBQ0YsWUFBTSxRQUFRO0FBQUEsUUFDWjtBQUFBLFFBQ0EsSUFBSSxZQUFZLEVBQUUsT0FBTyxHQUFHLEtBQUssVUFBVSxRQUFRLE1BQU0sQ0FBQyxDQUFDO0FBQUEsQ0FBSTtBQUFBLE1BQ2pFO0FBQUEsSUFDRixTQUFTLE9BQU87QUFDZCxXQUFLLFFBQVEsS0FBSyxpQ0FBaUMsS0FBSztBQUFBLElBQzFEO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQWMsWUFBMkI7QUEzTTNDO0FBNE1JLFFBQUksQ0FBQyxLQUFLLE9BQVE7QUFDbEIsU0FBSyxTQUFTO0FBRWQsVUFBTSxFQUFFLEtBQUssT0FBTyxTQUFTLElBQUksS0FBSztBQUN0QyxVQUFNLGFBQWEsS0FBSyxrQkFBa0I7QUFDMUMsVUFBTSxVQUFVLElBQUksdUJBQXVCLEVBQUUsU0FBUyxLQUFLLElBQUksTUFBTSxRQUFRLENBQUM7QUFDOUUsVUFBTSxLQUFLLHNCQUFzQixPQUFPO0FBRXhDLFVBQU0sU0FBUyxJQUFJLFdBQVc7QUFBQSxNQUM1QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxXQUFXLE1BQU0sSUFBSSxtQkFBbUIsRUFBRSxLQUFLLE9BQU8sV0FBVyxLQUFLLFVBQVUsVUFBVSxDQUFDO0FBQUEsTUFDM0YsV0FBVyxJQUFJLGNBQWMsRUFBRSxTQUFTLEtBQUssT0FBTyxXQUFXLEtBQUssVUFBVSxDQUFDO0FBQUEsTUFDL0U7QUFBQSxNQUNBLFVBQVUsRUFBRSxjQUFjLEtBQUssS0FBSyxTQUFTLGFBQWE7QUFBQSxNQUMxRCxLQUFLLEtBQUs7QUFBQSxNQUNWLEtBQUssS0FBSztBQUFBLElBQ1osQ0FBQztBQUNELFNBQUssU0FBUztBQUNkLFNBQUssYUFBYTtBQUNsQixTQUFLLGFBQWE7QUFDbEIsU0FBSyxhQUFhLElBQUkscUJBQW9CLFVBQUssVUFBVSxjQUFmLFlBQTRCLENBQUMsQ0FBQztBQUV4RSxRQUFJO0FBQ0YsWUFBTSxPQUFPLFFBQVE7QUFBQSxJQUN2QixTQUFTLE9BQU87QUFDZCxXQUFLLGdCQUFnQixPQUFPLHFCQUFxQjtBQUFBLElBQ25EO0FBR0EsU0FBSyxVQUFVLElBQUkscUJBQXFCLEVBQUUsT0FBTyxLQUFLLElBQUksTUFBTSxDQUFDO0FBQ2pFLFdBQU8sY0FBYyxLQUFLLE9BQU87QUFDakMsU0FBSyxTQUFTLElBQUksZ0JBQWdCO0FBQUEsTUFDaEMsWUFBWSxLQUFLLEtBQUssU0FBUyxvQkFBb0I7QUFBQSxJQUNyRCxDQUFDO0FBQ0QsU0FBSyxPQUFPLE1BQU0sTUFBTTtBQUN0QixXQUFLLE9BQU8sWUFBWSxFQUFFLE1BQU0sQ0FBQyxVQUFtQjtBQUNsRCxhQUFLLGdCQUFnQixPQUFPLGVBQWU7QUFBQSxNQUM3QyxDQUFDO0FBQUEsSUFDSCxDQUFDO0FBSUQsVUFBTSxPQUFPLEtBQUssaUJBQWlCO0FBQ25DLFNBQUssZ0JBQWdCO0FBQ3JCLFNBQUssWUFBWSxJQUFJLG1CQUFtQixJQUFJO0FBQzVDLFVBQU0sT0FBTyxZQUFZLE1BQU0sS0FBSyxPQUFPLEdBQUcsbUJBQW1CO0FBQ2pFLFNBQUssYUFBYTtBQUNsQixTQUFLLGlCQUFpQixJQUF5QjtBQUMvQyxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQUE7QUFBQSxFQUdRLFdBQWlCO0FBbFEzQjtBQW1RSSxRQUFJLEtBQUssbUJBQW1CLE1BQU07QUFDaEMsbUJBQWEsS0FBSyxjQUFjO0FBQ2hDLFdBQUssaUJBQWlCO0FBQUEsSUFDeEI7QUFDQSxRQUFJLEtBQUssZUFBZSxNQUFNO0FBQzVCLG9CQUFjLEtBQUssVUFBVTtBQUM3QixXQUFLLGFBQWE7QUFBQSxJQUNwQjtBQUNBLGVBQUssV0FBTCxtQkFBYTtBQUNiLFNBQUssU0FBUztBQUNkLGVBQUssV0FBTCxtQkFBYTtBQUNiLFNBQUssU0FBUztBQUNkLFNBQUssVUFBVTtBQUNmLGVBQUssa0JBQUwsbUJBQW9CO0FBQ3BCLFNBQUssZ0JBQWdCO0FBQ3JCLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUE7QUFBQSxFQUlBLE1BQU0sVUFBeUI7QUFDN0IsVUFBTSxTQUFTLEtBQUs7QUFDcEIsUUFBSSxXQUFXLE1BQU07QUFDbkIsVUFBSSx3QkFBTyxzRkFBaUY7QUFDNUY7QUFBQSxJQUNGO0FBQ0EsUUFBSTtBQUNGLFlBQU0sT0FBTyxZQUFZO0FBQ3pCLFlBQU0sU0FBUyxPQUFPLE9BQU87QUFDN0IsVUFBSTtBQUFBLFFBQ0YsT0FBTyxVQUFVLGlCQUNiLDhFQUNBO0FBQUEsTUFDTjtBQUFBLElBQ0YsU0FBUyxPQUFPO0FBQ2QsV0FBSyxnQkFBZ0IsT0FBTyxpQkFBaUI7QUFDN0MsVUFBSSx3QkFBTyxzRUFBaUU7QUFBQSxJQUM5RTtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sU0FBd0I7QUFDNUIsU0FBSyxTQUFTO0FBSWQsVUFBTSxVQUFVLElBQUksdUJBQXVCLEVBQUUsU0FBUyxLQUFLLElBQUksTUFBTSxRQUFRLENBQUM7QUFDOUUsVUFBTSxRQUFRLFdBQVcsd0JBQXdCO0FBQ2pELFVBQU0sUUFBUSxXQUFXLHNCQUFzQjtBQUMvQyxTQUFLLE9BQU87QUFBQSxNQUNWLEdBQUcsa0JBQWtCO0FBQUEsTUFDckIsWUFBWSxLQUFLLEtBQUs7QUFBQSxNQUN0QixVQUFVLEtBQUssS0FBSztBQUFBLElBQ3RCO0FBQ0EsVUFBTSxLQUFLLGVBQWU7QUFDMUIsUUFBSTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxvQkFBb0IsU0FBZ0M7QUE5VDVEO0FBK1RJLFNBQUssS0FBSyxTQUFTLG9CQUFvQixLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQ3RFLFVBQU0sS0FBSyxlQUFlO0FBQzFCLGVBQUssV0FBTCxtQkFBYSxjQUFjLEtBQUssS0FBSyxTQUFTLG9CQUFvQjtBQUFBLEVBQ3BFO0FBQUEsRUFFQSxNQUFNLGtCQUFrQixTQUFpQztBQUN2RCxTQUFLLEtBQUssU0FBUyxlQUFlO0FBQ2xDLFVBQU0sS0FBSyxlQUFlO0FBQzFCLFFBQUk7QUFBQSxNQUNGLFVBQ0kscUhBQ0E7QUFBQSxJQUNOO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFJUSxTQUFlO0FBaFZ6QjtBQWlWSSxVQUFNLFNBQVMsS0FBSztBQUNwQixRQUFJLFdBQVcsS0FBTTtBQUNyQixVQUFNLFNBQVMsT0FBTyxPQUFPO0FBQzdCLGVBQUssY0FBTCxtQkFBZ0I7QUFBQSxNQUNkO0FBQUEsTUFDQSxFQUFFLEtBQUssS0FBSyxLQUFLLEtBQUssWUFBWSxLQUFLLGtCQUFrQixHQUFHLE1BQU0sS0FBSyxXQUFXO0FBQUEsTUFDbEYsS0FBSyxJQUFJO0FBQUE7QUFFWCxRQUFJLEtBQUssV0FBWTtBQUNyQixVQUFNLFdBQVcsS0FBSyxXQUFXLFNBQVMsT0FBTyxLQUFLO0FBQ3RELFFBQUksU0FBUyxXQUFXLE9BQVE7QUFDaEMsU0FBSyxXQUFXLGFBQWE7QUFDN0IsU0FBSyxrQkFBa0IsU0FBUyxPQUFPO0FBQUEsRUFDekM7QUFBQSxFQUVRLGtCQUFrQixTQUF1QjtBQUMvQyxRQUFJLEtBQUssbUJBQW1CLEtBQU07QUFDbEMsU0FBSyxpQkFBaUIsV0FBVyxNQUFNO0FBQ3JDLFdBQUssaUJBQWlCO0FBQ3RCLFlBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQUksV0FBVyxNQUFNO0FBQ25CLGFBQUssV0FBVyxRQUFRO0FBQ3hCO0FBQUEsTUFDRjtBQUNBLGFBQ0csVUFBVSxFQUNWO0FBQUEsUUFDQyxNQUFNO0FBQ0osZUFBSyxXQUFXLFFBQVE7QUFBQSxRQUMxQjtBQUFBLFFBQ0EsQ0FBQyxVQUFtQjtBQUNsQixlQUFLLFdBQVcsUUFBUTtBQUN4QixlQUFLLGdCQUFnQixPQUFPLGtCQUFrQjtBQUFBLFFBQ2hEO0FBQUEsTUFDRixFQUNDLE1BQU0sTUFBTTtBQUFBLE1BQUMsQ0FBQztBQUFBLElBQ25CLEdBQUcsT0FBTztBQUFBLEVBQ1o7QUFBQTtBQUFBLEVBR1EsZ0JBQWdCLE9BQWdCLFNBQXVCO0FBQzdELFFBQUksaUJBQWlCLGdCQUFnQixpQkFBaUIsbUJBQW1CO0FBQ3ZFLFdBQUssYUFBYTtBQUNsQixXQUFLLGFBQWE7QUFDbEIsV0FBSyxRQUFRLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFVBQUk7QUFBQSxRQUNGO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLFFBQVEsS0FBSyxTQUFTLEtBQUs7QUFBQSxFQUNsQztBQUFBO0FBQUEsRUFHQSxNQUFjLHNCQUFzQixTQUFnRDtBQUNsRixRQUFJO0FBQ0osUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLFFBQVEsU0FBUyx3QkFBd0I7QUFDN0QsZUFBUyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUNyRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFDRSxPQUFPLE9BQU8sYUFBYSxZQUMzQixPQUFPLGFBQWEsS0FBSyxLQUFLLFVBQzlCO0FBQ0EsWUFBTSxPQUFPLE9BQU8sT0FBTyxlQUFlLFdBQVcsT0FBTyxhQUFhLE9BQU87QUFDaEYsWUFBTSxRQUFRLE9BQU8sT0FBTyxRQUFRLFdBQVcsT0FBTyxNQUFNO0FBQzVELFVBQUk7QUFBQSxRQUNGLDREQUE0RCxJQUFJLGdCQUFnQixLQUFLO0FBQUEsUUFHckY7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELE1BQUk7QUFDRixXQUFPLG1CQUFtQixLQUFLO0FBQUEsRUFDakMsU0FBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJfYSIsICJfYiIsICJfYyIsICJfZCIsICJfZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIl0KfQo=
