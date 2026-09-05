import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";

const sessionDirectories = ["sessions"];
const sqliteSidecarSuffixes = ["", "-wal", "-shm", "-journal"];
// Provider switching only needs the session header and the latest turn model.
// Reading megabytes from every rollout made a 6GB Codex home feel like a full
// backup. A bounded tail keeps discovery fast while the full history remains
// untouched.
const metadataTailBytes = 128 * 1024;
const officialMessageScanCacheVersion = 1;
const officialMessageScanCacheName = "codex-galaxy-official-message-id-cache.json";

export function targetProviderForProfile(profile) {
  if (profile.kind === "official") return "openai";
  // A fixed six-character runtime provider keeps the session header length
  // stable across API-to-API and official-to-API switches. The logical profile
  // providerKey remains available for display/catalog identity.
  return String(profile.runtimeProvider || profile.providerKey || profile.id).trim();
}

function sourceMarksNonRootAgent(source) {
  if (source && typeof source === "object") {
    return ["sub_agent", "subagent", "internal"].some((key) => Object.hasOwn(source, key));
  }
  if (typeof source !== "string") return false;
  const value = source.trim().toLowerCase();
  return value === "subagent" || value === "internal" || value.startsWith("subagent_") || value.startsWith("internal_");
}

function splitLine(segment) {
  if (segment.endsWith("\r\n")) return [segment.slice(0, -2), "\r\n"];
  if (segment.endsWith("\n")) return [segment.slice(0, -1), "\n"];
  return [segment, ""];
}

function linesWithEndings(text) {
  return text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
}

async function readFirstLine(file) {
  const input = createReadStream(file);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of input) {
      const newline = chunk.indexOf(0x0a);
      const part = newline >= 0 ? chunk.subarray(0, newline) : chunk;
      chunks.push(part);
      total += part.length;
      if (newline >= 0 || total > metadataTailBytes) break;
    }
  } finally {
    input.destroy();
  }
  if (!chunks.length || total > metadataTailBytes) return null;
  const value = Buffer.concat(chunks, total);
  const end = value.length && value[value.length - 1] === 0x0d ? value.length - 1 : value.length;
  return value.subarray(0, end).toString("utf8");
}

async function readTailText(file, maxBytes = metadataTailBytes) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    if (!length) return { text: "", size: stat.size };
    const start = stat.size - length;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { text, size: stat.size };
  } finally {
    await handle.close();
  }
}

function officialMessageScanCachePath(codexHome) {
  return path.join(codexHome, "backups_state", officialMessageScanCacheName);
}

function fileCacheKey(codexHome, file) {
  const relative = path.relative(codexHome, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replaceAll("\\", "/");
}

function fileCacheStamp(stat) {
  return {
    size: Number(stat?.size || 0),
    mtimeMs: Math.round(Number(stat?.mtimeMs || 0)),
  };
}

function cacheStampMatches(entry, stat) {
  const stamp = fileCacheStamp(stat);
  return Number(entry?.size) === stamp.size && Number(entry?.mtimeMs) === stamp.mtimeMs;
}

async function readOfficialMessageScanCache(codexHome) {
  const file = officialMessageScanCachePath(codexHome);
  const data = await fs.readFile(file, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => null);
  return data?.version === officialMessageScanCacheVersion && data.files && typeof data.files === "object"
    ? data
    : { version: officialMessageScanCacheVersion, files: {} };
}

async function writeOfficialMessageScanCache(codexHome, files) {
  const file = officialMessageScanCachePath(codexHome);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({
      version: officialMessageScanCacheVersion,
      updatedAt: new Date().toISOString(),
      files,
    }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function parseSessionMetaLine(line) {
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  return record?.type === "session_meta" && record.payload && typeof record.payload === "object" ? record : null;
}

function sessionMetaLineForProvider(line, targetProvider) {
  const record = parseSessionMetaLine(line);
  if (!record) throw new Error("会话元数据格式无效。");
  record.payload.model_provider = targetProvider;
  return JSON.stringify(record);
}

function removeExactJsonProperty(line, property, value, expectedRecord) {
  const serializedValue = JSON.stringify(value);
  if (serializedValue === undefined) return null;
  const token = `${JSON.stringify(property)}:${serializedValue}`;
  let offset = 0;
  while (offset < line.length) {
    const index = line.indexOf(token, offset);
    if (index < 0) return null;
    const end = index + token.length;
    const candidates = [];
    if (line[index - 1] === ",") candidates.push(`${line.slice(0, index - 1)}${line.slice(end)}`);
    if (line[end] === ",") candidates.push(`${line.slice(0, index)}${line.slice(end + 1)}`);
    for (const candidate of candidates) {
      try {
        if (JSON.stringify(JSON.parse(candidate)) === JSON.stringify(expectedRecord)) return candidate;
      } catch {}
    }
    offset = end;
  }
  return null;
}

function officialMessageLineWithoutInvalidId(line) {
  if (!line.includes('"response_item"') || !line.includes('"id"')) return null;
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  if (record?.type !== "response_item" || !record.payload || typeof record.payload !== "object" || !Object.hasOwn(record.payload, "id")) return null;
  const itemType = record.payload.type;
  const idPrefix = itemType === "message"
    ? "msg"
    : itemType === "function_call"
      ? "fc"
      : null;
  // Relay function-call items commonly use `call_...` for both `id` and
  // `call_id`.  The official Responses API accepts the call_id value but
  // requires the item id to use the `fc...` namespace.  Remove only the
  // incompatible item id when returning to the official provider; API-to-API
  // switches never call this function.
  if (!idPrefix) return null;
  const id = record.payload.id;
  if (typeof id === "string" && id.startsWith(idPrefix)) return null;
  delete record.payload.id;
  return removeExactJsonProperty(line, "id", id, record) || JSON.stringify(record);
}

async function officialMessageIdReplacements(file, onBytes = null) {
  const input = createReadStream(file);
  const decoder = new StringDecoder("utf8");
  const replacements = [];
  let carry = "";
  let lineNumber = 0;

  const inspectSegment = (segment) => {
    const [line] = splitLine(segment);
    const nextLine = officialMessageLineWithoutInvalidId(line);
    if (nextLine !== null) replacements.push({ lineNumber, expectedLine: line, nextLine, kind: "official-response-item-id" });
    lineNumber += 1;
  };
  const consume = (final = false) => {
    let newline;
    while ((newline = carry.indexOf("\n")) >= 0) {
      inspectSegment(carry.slice(0, newline + 1));
      carry = carry.slice(newline + 1);
    }
    if (final && carry) {
      inspectSegment(carry);
      carry = "";
    }
  };

  try {
    for await (const chunk of input) {
      onBytes?.(chunk.length);
      carry += decoder.write(chunk);
      consume();
    }
    carry += decoder.end();
    consume(true);
    return replacements;
  } finally {
    input.destroy();
  }
}

function modelsFromTail(text) {
  const models = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes('"turn_context"') || !line.includes('"model"')) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const model = record?.type === "turn_context" ? String(record.payload?.model || "").trim() : "";
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

async function inspectSessionFile(file, targetProvider, {
  codexHome = null,
  fileStat = null,
  officialScanCache = null,
  onOfficialScanBytes = null,
  messageIdScanThreadId = null,
} = {}) {
  const stat = fileStat || await fs.stat(file);
  const firstLine = await readFirstLine(file);
  const metadata = firstLine ? parseSessionMetaLine(firstLine) : null;
  if (!metadata) return null;
  const threadId = metadata.payload.id ? String(metadata.payload.id) : null;
  const nonRoot = sourceMarksNonRootAgent(metadata.payload.source);
  const tail = await readTailText(file);
  const models = modelsFromTail(tail.text);
  const metadataChanged = !nonRoot && metadata.payload.model_provider !== targetProvider;
  const nextLine = metadataChanged ? sessionMetaLineForProvider(firstLine, targetProvider) : null;
  // Keep a relative key for API transitions too so a header-only rewrite can
  // carry forward a previously trusted official-ID cache stamp.
  const cacheKey = !nonRoot && codexHome ? fileCacheKey(codexHome, file) : null;
  const officialMessageIdsCached = Boolean(cacheKey && cacheStampMatches(officialScanCache?.files?.[cacheKey], stat));
  const scanThisThread = !messageIdScanThreadId || threadId === String(messageIdScanThreadId);
  const officialMessageIdsScanned = targetProvider === "openai" && !nonRoot && scanThisThread && !officialMessageIdsCached;
  const messageIdReplacements = officialMessageIdsScanned
    ? await officialMessageIdReplacements(file, onOfficialScanBytes)
    : [];
  const replacements = [
    ...(metadataChanged ? [{ lineNumber: 0, expectedLine: firstLine, nextLine, kind: "session-meta" }] : []),
    ...messageIdReplacements,
  ];
  const changed = replacements.length > 0;
  return {
    path: file,
    fileSize: stat.size,
    originalMtime: stat.mtime,
    threadId,
    nonRoot,
    hasUserEvent: tail.text.includes('"user_message"') || tail.text.includes('"user_input"'),
    lastTurnModel: models[0] || null,
    encryptedContent: tail.text.includes('"encrypted_content"'),
    changed,
    inPlaceEligible: Boolean(
      replacements.length === 1
      && replacements[0].lineNumber === 0
      && Buffer.byteLength(replacements[0].nextLine) <= Buffer.byteLength(firstLine),
    ),
    originalSessionMetaLines: metadataChanged ? [firstLine] : [],
    originalSessionMetaEntries: metadataChanged ? [{ lineNumber: 0, line: firstLine }] : [],
    replacements,
    sanitizedMessageIds: messageIdReplacements.length,
    officialMessageIdsCached,
    officialMessageIdsScanned,
    officialMessageScanCacheKey: cacheKey,
  };
}

// Determine which files really need a full official-compatibility scan before
// entering the provider-sync loop.  The cache is keyed by the relative path
// and the file's size/mtime, so cached multi-gigabyte rollouts can be omitted
// from the byte-progress denominator.  This preflight only reads each file's
// first JSONL line; it never reads the history body.
async function officialScanPlan(fileEntries, codexHome, officialScanCache, messageIdScanThreadId = null) {
  let bytes = 0;
  let files = 0;
  let cachedBytes = 0;
  let cachedFiles = 0;
  let targetMatched = !messageIdScanThreadId;
  for (const entry of fileEntries) {
    const firstLine = await readFirstLine(entry.file).catch(() => null);
    const metadata = firstLine ? parseSessionMetaLine(firstLine) : null;
    const threadId = metadata?.payload?.id ? String(metadata.payload.id) : null;
    const nonRoot = Boolean(metadata && sourceMarksNonRootAgent(metadata.payload.source));
    const key = metadata && !nonRoot ? fileCacheKey(codexHome, entry.file) : null;
    const cached = Boolean(key && cacheStampMatches(officialScanCache?.files?.[key], entry.stat));
    if (cached) {
      cachedFiles += 1;
      cachedBytes += Number(entry.stat.size || 0);
    }
    if (messageIdScanThreadId && threadId && threadId === String(messageIdScanThreadId) && metadata && !nonRoot) targetMatched = true;
    let needsScan = true;
    if (!metadata) {
      // inspectSessionFile ignores files without a valid session header, so
      // they cannot contain a rollout that needs official ID sanitization.
      needsScan = false;
    } else if (nonRoot) {
      needsScan = false;
    } else if (messageIdScanThreadId && threadId !== String(messageIdScanThreadId)) {
      needsScan = false;
    } else if (metadata) {
      needsScan = !cached;
    }
    if (needsScan) {
      files += 1;
      bytes += Number(entry.stat.size || 0);
    }
  }
  return { bytes, files, cachedBytes, cachedFiles, targetMatched };
}

export function rewriteSessionMetadata(text, targetProvider) {
  const metadata = [];
  let nonRoot = false;
  let threadId = null;
  let hasUserEvent = false;
  let lastTurnModel = null;

  for (const segment of linesWithEndings(text)) {
    const [line] = splitLine(segment);
    if (line.includes('"user_message"') || line.includes('"user_input"')) hasUserEvent = true;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record?.type === "turn_context" && record.payload?.model) lastTurnModel = String(record.payload.model).trim() || lastTurnModel;
    if (record?.type !== "session_meta" || !record.payload || typeof record.payload !== "object") continue;
    metadata.push(record);
    threadId ||= record.payload.id ? String(record.payload.id) : null;
    if (sourceMarksNonRootAgent(record.payload.source)) nonRoot = true;
  }

  if (!metadata.length || nonRoot) {
    return { text, changed: false, threadId, nonRoot, hasUserEvent, lastTurnModel, encryptedContent: text.includes("encrypted_content"), originalSessionMetaLines: [] };
  }

  const originalSessionMetaLines = [];
  const originalSessionMetaEntries = [];
  let changed = false;
  const nextText = linesWithEndings(text).map((segment, lineNumber) => {
    const [line, ending] = splitLine(segment);
    let record;
    try { record = JSON.parse(line); } catch { return segment; }
    if (record?.type !== "session_meta" || !record.payload || typeof record.payload !== "object") return segment;
    if (record.payload.model_provider === targetProvider) return segment;
    originalSessionMetaLines.push(line);
    originalSessionMetaEntries.push({ lineNumber, line });
    record.payload.model_provider = targetProvider;
    changed = true;
    return `${JSON.stringify(record)}${ending}`;
  }).join("");

  return {
    text: nextText,
    changed,
    threadId,
    nonRoot: false,
    hasUserEvent,
    lastTurnModel,
    encryptedContent: text.includes("encrypted_content"),
    originalSessionMetaLines,
    originalSessionMetaEntries,
  };
}

async function walkJsonl(directory, output = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkJsonl(fullPath, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) output.push(fullPath);
  }
  return output;
}

async function rolloutFiles(codexHome) {
  const files = [];
  for (const directory of sessionDirectories) await walkJsonl(path.join(codexHome, directory), files);
  return files;
}

export async function recentThreadModels(codexHome, targetProvider = null, limit = 20) {
  const files = await rolloutFiles(codexHome);
  const ordered = await Promise.all(files.map(async (file) => ({
    file,
    mtimeMs: await fs.stat(file).then((item) => item.mtimeMs).catch(() => 0),
  })));
  ordered.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const models = [];
  const seen = new Set();
  for (const item of ordered) {
    const firstLine = await readFirstLine(item.file).catch(() => null);
    const metadata = firstLine ? parseSessionMetaLine(firstLine) : null;
    if (!metadata || sourceMarksNonRootAgent(metadata.payload.source)) continue;
    const provider = String(metadata.payload.model_provider || "").trim() || null;
    if (targetProvider && provider !== targetProvider) continue;
    const tail = await readTailText(item.file).catch(() => ({ text: "" }));
    for (const model of modelsFromTail(tail.text)) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      models.push(model);
      if (models.length >= limit) return models;
    }
  }
  return models;
}

async function sqlitePaths(codexHome) {
  const candidates = [];
  const rootEntries = await fs.readdir(codexHome, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (entry.isFile() && /^state(?:_\d+)?\.sqlite$/i.test(entry.name)) candidates.push(path.join(codexHome, entry.name));
  }
  const sqliteHome = path.join(codexHome, "sqlite");
  const sqliteEntries = await fs.readdir(sqliteHome, { withFileTypes: true }).catch(() => []);
  for (const entry of sqliteEntries) {
    if (entry.isFile() && /\.(?:sqlite|db)$/i.test(entry.name)) candidates.push(path.join(sqliteHome, entry.name));
  }
  return [...new Set(candidates)];
}

function backupName() {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

async function createBackup(codexHome, targetProvider, targetModel, changes, databases) {
  const root = path.join(codexHome, "backups_state", "codex-galaxy-provider-sync");
  let backupDir = path.join(root, backupName());
  let suffix = 0;
  while (await fs.stat(backupDir).then(() => true).catch(() => false)) backupDir = path.join(root, `${backupName()}-${++suffix}`);
  await fs.mkdir(path.join(backupDir, "db"), { recursive: true });

  const databaseFiles = [];
  for (const database of databases) {
    for (const sidecar of sqliteSidecarSuffixes) {
      const source = `${database}${sidecar}`;
      if (!await fs.stat(source).then((item) => item.isFile()).catch(() => false)) continue;
      const relative = path.relative(codexHome, source);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("SQLite 备份路径超出 Codex 数据目录。");
      const target = path.join(backupDir, "db", relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      databaseFiles.push({ source, backup: target });
    }
  }

  const officialCacheFile = officialMessageScanCachePath(codexHome);
  const officialCacheContents = await fs.readFile(officialCacheFile).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  const officialMessageScanCache = officialCacheContents === null
    ? { existed: false }
    : { existed: true, backup: officialMessageScanCacheName };
  if (officialCacheContents !== null) {
    await fs.writeFile(path.join(backupDir, officialMessageScanCache.backup), officialCacheContents, { mode: 0o600 });
  }

  const manifest = changes.map((change) => ({
    path: change.path,
    originalSessionMetaLines: change.originalSessionMetaLines,
    originalSessionMetaEntries: change.originalSessionMetaEntries,
    lineBackups: change.replacements.map((replacement) => ({
      lineNumber: replacement.lineNumber,
      originalLine: replacement.expectedLine,
      nextLine: replacement.nextLine,
      kind: replacement.kind || "line",
    })),
  }));
  await fs.writeFile(path.join(backupDir, "session-meta-backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(backupDir, "metadata.json"), `${JSON.stringify({
    version: 3,
    namespace: "codex-galaxy-provider-sync",
    targetProvider,
    targetModel,
    createdAt: new Date().toISOString(),
    databaseFiles: databaseFiles.map((item) => path.relative(backupDir, item.backup).replaceAll("\\", "/")),
    changedSessionFiles: changes.length,
    officialMessageScanCache,
  }, null, 2)}\n`, { mode: 0o600 });
  await pruneBackupHistory(root, 8);
  return { backupDir, databaseFiles };
}

async function pruneBackupHistory(root, keep = 8) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const stat = await fs.stat(directory).catch(() => null);
    if (stat) directories.push({ directory, mtimeMs: stat.mtimeMs });
  }
  directories.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const item of directories.slice(keep)) await fs.rm(item.directory, { recursive: true, force: true });
}

class ExpectedLineMismatchError extends Error {}

async function replaceFirstLineInPlace(file, replacement, originalMtime = null) {
  if (replacement?.lineNumber !== 0 || typeof replacement.expectedLine !== "string" || typeof replacement.nextLine !== "string") return false;
  const expected = Buffer.from(replacement.expectedLine, "utf8");
  const next = Buffer.from(replacement.nextLine, "utf8");
  if (next.length > expected.length) return false;
  const handle = await fs.open(file, "r+");
  try {
    const probe = Buffer.alloc(expected.length + 2);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    let newlineLength = 0;
    for (let index = expected.length; index < bytesRead; index += 1) {
      if (probe[index] === 0x0a) {
        newlineLength = index === expected.length + 1 && probe[index - 1] === 0x0d ? 2 : 1;
        break;
      }
    }
    if (!newlineLength || !probe.subarray(0, expected.length).equals(expected)) return false;
    const padded = Buffer.alloc(expected.length + newlineLength, 0x20);
    next.copy(padded, 0);
    if (newlineLength === 2) padded[padded.length - 2] = 0x0d;
    padded[padded.length - 1] = 0x0a;
    await handle.write(padded, 0, padded.length, 0);
    await handle.sync();
    if (originalMtime) await fs.utimes(file, originalMtime, originalMtime).catch(() => {});
    return true;
  } finally {
    await handle.close();
  }
}

async function replaceExpectedLines(file, replacements, originalMtime = null, onBytes = null) {
  if (replacements.length === 1 && replacements[0].lineNumber === 0) {
    const patched = await replaceFirstLineInPlace(file, replacements[0], originalMtime);
    if (patched) {
      onBytes?.(0);
      return true;
    }
  }
  const replacementByLine = new Map(replacements.map((item) => [item.lineNumber, item]));
  const temp = `${file}.${process.pid}-${Date.now()}.galaxy.tmp`;
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let lineNumber = 0;
  let replaced = 0;

  const transformSegment = (segment) => {
    const [line, ending] = splitLine(segment);
    const replacement = replacementByLine.get(lineNumber);
    lineNumber += 1;
    if (!replacement) return segment;
    if (line !== replacement.expectedLine) throw new ExpectedLineMismatchError("会话文件在同步期间发生了变化。");
    replaced += 1;
    return `${replacement.nextLine}${ending}`;
  };

  const consume = (final = false) => {
    let output = "";
    let newline;
    while ((newline = carry.indexOf("\n")) >= 0) {
      output += transformSegment(carry.slice(0, newline + 1));
      carry = carry.slice(newline + 1);
    }
    if (final && carry) {
      output += transformSegment(carry);
      carry = "";
    }
    return output;
  };

  const patcher = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        onBytes?.(Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk));
        carry += decoder.write(chunk);
        callback(null, consume());
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        carry += decoder.end();
        const output = consume(true);
        if (replaced !== replacementByLine.size) throw new ExpectedLineMismatchError("找不到待更新的会话元数据。");
        callback(null, output);
      } catch (error) {
        callback(error);
      }
    },
  });

  try {
    await pipeline(createReadStream(file), patcher, createWriteStream(temp, { mode: 0o600 }));
    await fs.rename(temp, file);
    if (originalMtime) await fs.utimes(file, originalMtime, originalMtime).catch(() => {});
    return true;
  } catch (error) {
    await fs.rm(temp, { force: true });
    if (error instanceof ExpectedLineMismatchError) return false;
    throw error;
  }
}

async function tableColumns(db, table) {
  try {
    return new Set(db.prepare(`pragma table_info("${table}")`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
}

async function updateSqliteThreadRuntime(databasePath, targetProvider, targetModel, rootThreads) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(databasePath);
  let updated = 0;
  let modelRowsUpdated = 0;
  try {
    db.exec("begin immediate");
    for (const [table, idColumn] of [["threads", "id"], ["local_thread_catalog", "thread_id"]]) {
      const columns = await tableColumns(db, table);
      if (!columns.has(idColumn) || !columns.has("model_provider")) continue;
      const update = db.prepare(`update "${table}" set model_provider = ? where "${idColumn}" = ? and coalesce(model_provider, '') <> ?`);
      for (const threadId of rootThreads.keys()) updated += Number(update.run(targetProvider, threadId, targetProvider).changes || 0);
    }
    const threadColumns = await tableColumns(db, "threads");
    if (threadColumns.has("id") && threadColumns.has("model")) {
      const update = db.prepare("update threads set model = ? where id = ? and coalesce(model, '') <> ?");
      for (const [threadId, thread] of rootThreads) {
        const model = targetModel || thread.lastTurnModel;
        if (!model) continue;
        const changes = Number(update.run(model, threadId, model).changes || 0);
        modelRowsUpdated += changes;
        updated += changes;
      }
    }
    if (threadColumns.has("id") && threadColumns.has("has_user_event")) {
      const update = db.prepare("update threads set has_user_event = 1 where id = ? and coalesce(has_user_event, 0) <> 1");
      for (const [threadId, thread] of rootThreads) if (thread.hasUserEvent) updated += Number(update.run(threadId).changes || 0);
    }
    db.exec("commit");
    return { rowsUpdated: updated, modelRowsUpdated };
  } catch (error) {
    try { db.exec("rollback"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

async function restoreDatabases(codexHome, databases, databaseFiles) {
  for (const database of databases) {
    const relative = path.relative(codexHome, database);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    for (const sidecar of sqliteSidecarSuffixes) await fs.rm(`${database}${sidecar}`, { force: true });
  }
  for (const file of databaseFiles) {
    await fs.mkdir(path.dirname(file.source), { recursive: true });
    await fs.copyFile(file.backup, file.source);
  }
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH" || error?.code === "EINVAL") return false;
    return true;
  }
}

async function lockOwnerState(lock) {
  const owner = await fs.readFile(path.join(lock, "owner.json"), "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => null);
  return processIsRunning(Number(owner?.pid));
}

async function acquireLock(codexHome) {
  const lock = path.join(codexHome, "tmp", "codex-galaxy-provider-sync.lock");
  await fs.mkdir(path.dirname(lock), { recursive: true });
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const ownerRunning = await lockOwnerState(lock);
    const age = Date.now() - await fs.stat(lock).then((item) => item.mtimeMs).catch(() => Date.now());
    if (ownerRunning === true || (ownerRunning === null && age < 10 * 60 * 1000)) {
      throw new Error("另一个 Codex Galaxy 实例正在同步，请等待完成。");
    }
    await fs.rm(lock, { recursive: true, force: true });
    try {
      await fs.mkdir(lock);
    } catch (retryError) {
      if (retryError?.code === "EEXIST") throw new Error("另一个 Codex Galaxy 实例正在同步，请等待完成。");
      throw retryError;
    }
  }
  await fs.writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  return lock;
}

async function persistOfficialMessageScanCache(codexHome, inspectedFiles, appliedPaths = new Set()) {
  const files = {};
  for (const inspected of inspectedFiles) {
    const key = inspected?.officialMessageScanCacheKey;
    if (!key || (!inspected.officialMessageIdsCached && !inspected.officialMessageIdsScanned)) continue;
    if (inspected.sanitizedMessageIds > 0 && !appliedPaths.has(inspected.path)) continue;
    const stat = await fs.stat(inspected.path).catch(() => null);
    if (!stat) continue;
    if (inspected.sanitizedMessageIds === 0 && !cacheStampMatches(inspected.originalFileStamp, stat)) continue;
    files[key] = fileCacheStamp(stat);
  }
  await writeOfficialMessageScanCache(codexHome, files);
  return Object.keys(files).length;
}

// Switching providers can rewrite only the session header.  A full rewrite is
// used when the new provider name is longer, so the file size changes even
// though every historical body byte remains identical.  Carry the trusted
// official-ID stamp across that header-only rewrite; never do this for a file
// that also had message IDs changed or any other replacement.
async function preserveOfficialMessageScanCacheAfterHeaderSync(codexHome, officialScanCache, inspectedFiles, appliedPaths) {
  if (!officialScanCache?.files || !Object.keys(officialScanCache.files).length) return 0;
  const files = { ...officialScanCache.files };
  let updated = 0;
  for (const inspected of inspectedFiles) {
    const key = inspected?.officialMessageScanCacheKey;
    if (!key || !appliedPaths.has(inspected.path)) continue;
    if (inspected.sanitizedMessageIds > 0 || !Array.isArray(inspected.replacements) || !inspected.replacements.length) continue;
    if (!inspected.replacements.every((replacement) => replacement.kind === "session-meta")) continue;
    if (!cacheStampMatches(files[key], inspected.originalFileStamp)) continue;
    const stat = await fs.stat(inspected.path).catch(() => null);
    if (!stat) continue;
    files[key] = fileCacheStamp(stat);
    updated += 1;
  }
  if (updated) await writeOfficialMessageScanCache(codexHome, files);
  return updated;
}

async function officialMessageScanCacheBytes(codexHome) {
  const cache = await readOfficialMessageScanCache(codexHome);
  return Object.values(cache.files || {}).reduce((sum, stamp) => sum + Number(stamp?.size || 0), 0);
}

export async function syncProviderMetadata({ codexHome, targetProvider, targetModel, messageIdScanThreadId = null, rewriteSessionFiles = true, onProgress = null }) {
  if (!targetProvider) throw new Error("目标 provider 不能为空。");
  const normalizedTargetModel = String(targetModel || "").trim() || null;
  const lock = await acquireLock(codexHome);
  try {
    const changes = [];
    const inspectedFiles = [];
    const rootThreads = new Map();
    let encryptedContentFiles = 0;
    const files = rewriteSessionFiles ? await rolloutFiles(codexHome) : [];
    const fileEntries = (await Promise.all(files.map(async (file) => ({
      file,
      stat: await fs.stat(file).catch(() => null),
    })))).filter((entry) => entry.stat);
    // Keep the official-ID cache available during API switches as well: a
    // header-only provider rewrite must carry its trusted file stamp forward.
    const officialScanCache = await readOfficialMessageScanCache(codexHome);
    // Only uncached files are read byte-for-byte.  Previously the progress
    // denominator included every historical rollout (including cached files),
    // making a fast incremental check look like a 6+ GB migration.
    let effectiveMessageIdScanThreadId = messageIdScanThreadId;
    let officialPlan = targetProvider === "openai"
      ? await officialScanPlan(fileEntries, codexHome, officialScanCache, effectiveMessageIdScanThreadId)
      : { bytes: 0, files: 0, cachedBytes: 0, cachedFiles: 0, targetMatched: true };
    // Only narrow the scan when the requested thread exists. A stale library
    // entry must fall back to the safe full scan rather than leave an
    // unverified relay ID in the thread the user is about to continue.
    if (targetProvider === "openai" && messageIdScanThreadId && !officialPlan.targetMatched) {
      effectiveMessageIdScanThreadId = null;
      officialPlan = await officialScanPlan(fileEntries, codexHome, officialScanCache);
    }
    const officialProgressDetails = targetProvider === "openai"
      ? {
          scanFiles: officialPlan.files,
          cachedFiles: officialPlan.cachedFiles,
          cachedBytes: officialPlan.cachedBytes,
        }
      : {};
    const scanTotalBytes = officialPlan.bytes;
    let scanProcessedBytes = 0;
    let officialScannedBytes = 0;
    let lastScanByteReport = 0;
    let lastScanReportAt = 0;
    let completed = 0;
    const reportScan = (force = false) => {
      const now = Date.now();
      if (!force && scanProcessedBytes - lastScanByteReport < 8 * 1024 * 1024 && now - lastScanReportAt < 250) return;
      lastScanByteReport = scanProcessedBytes;
      lastScanReportAt = now;
      onProgress?.({
        phase: "scan",
        completed,
        total: fileEntries.length,
        processedBytes: Math.min(scanProcessedBytes, scanTotalBytes),
        totalBytes: scanTotalBytes,
        ...officialProgressDetails,
      });
    };
    reportScan(true);
    for (const entry of fileEntries) {
      let inspected;
      try {
        inspected = await inspectSessionFile(entry.file, targetProvider, {
          codexHome,
          fileStat: entry.stat,
          officialScanCache,
          messageIdScanThreadId: effectiveMessageIdScanThreadId,
          onOfficialScanBytes: (bytes) => {
            officialScannedBytes += bytes;
            scanProcessedBytes = Math.min(scanTotalBytes, scanProcessedBytes + bytes);
            reportScan();
          },
        });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        inspected = null;
      }
      if (inspected) {
        inspected.originalFileStamp = fileCacheStamp(entry.stat);
        inspectedFiles.push(inspected);
        if (!inspected.nonRoot && inspected.threadId) rootThreads.set(inspected.threadId, { hasUserEvent: inspected.hasUserEvent, lastTurnModel: inspected.lastTurnModel });
        if (inspected.changed) {
          changes.push(inspected);
          if (inspected.encryptedContent) encryptedContentFiles += 1;
        }
      }
      completed += 1;
      reportScan(true);
    }

    const databases = await sqlitePaths(codexHome);
    if (!changes.length && !databases.length) {
      const cachedOfficialSessionFiles = targetProvider === "openai"
        ? await persistOfficialMessageScanCache(codexHome, inspectedFiles)
        : 0;
      const cachedOfficialSessionBytes = targetProvider === "openai"
        ? await officialMessageScanCacheBytes(codexHome)
        : 0;
      onProgress?.({
        phase: "complete",
        completed: fileEntries.length,
        total: fileEntries.length,
        processedBytes: Math.min(scanProcessedBytes, scanTotalBytes),
        totalBytes: scanTotalBytes,
        ...officialProgressDetails,
      });
      return {
        targetProvider,
        targetModel: normalizedTargetModel,
        changedSessionFiles: 0,
        sqliteRowsUpdated: 0,
        modelRowsUpdated: 0,
        skippedSessionFiles: 0,
        backupDir: null,
        encryptedContentFiles: 0,
        sanitizedMessageIds: 0,
        scannedOfficialSessionBytes: officialScannedBytes,
        officialScanTotalBytes: scanTotalBytes,
        officialScanFiles: officialPlan.files,
        cachedOfficialSessionBytes,
        cachedOfficialSessionFiles,
      };
    }
    const backup = await createBackup(codexHome, targetProvider, normalizedTargetModel, changes, databases);
    const applied = [];
    let officialCacheHeaderSyncUpdated = false;
    let skippedSessionFiles = 0;
    try {
      const totalBytes = changes.reduce((sum, change) => sum + (change.inPlaceEligible ? 0 : change.fileSize), 0);
      let processedBytes = 0;
      let sanitizedMessageIds = 0;
      let rewriteCompleted = 0;
      let lastByteReport = 0;
      let lastReportAt = 0;
      const reportRewrite = (force = false) => {
        const now = Date.now();
        if (!force && processedBytes - lastByteReport < 8 * 1024 * 1024 && now - lastReportAt < 250) return;
        lastByteReport = processedBytes;
        lastReportAt = now;
        onProgress?.({ phase: "rewrite", completed: rewriteCompleted, total: changes.length, processedBytes, totalBytes });
      };
      reportRewrite(true);
      for (const change of changes) {
        const expectedEnd = Math.min(totalBytes, processedBytes + (change.inPlaceEligible ? 0 : change.fileSize));
        if (await replaceExpectedLines(change.path, change.replacements, change.originalMtime, (bytes) => {
          processedBytes = Math.min(totalBytes, processedBytes + bytes);
          reportRewrite();
        })) {
          applied.push(change);
          sanitizedMessageIds += change.sanitizedMessageIds;
        }
        else skippedSessionFiles += 1;
        processedBytes = Math.max(processedBytes, expectedEnd);
        rewriteCompleted += 1;
        reportRewrite(true);
      }
      onProgress?.({ phase: "database", completed: rewriteCompleted, total: changes.length, processedBytes: totalBytes, totalBytes });
      let sqliteRowsUpdated = 0;
      let modelRowsUpdated = 0;
      for (const database of databases) {
        const sqliteUpdate = await updateSqliteThreadRuntime(database, targetProvider, normalizedTargetModel, rootThreads);
        sqliteRowsUpdated += sqliteUpdate.rowsUpdated;
        modelRowsUpdated += sqliteUpdate.modelRowsUpdated;
      }
      if (targetProvider !== "openai") {
        officialCacheHeaderSyncUpdated = (await preserveOfficialMessageScanCacheAfterHeaderSync(
          codexHome,
          officialScanCache,
          inspectedFiles,
          new Set(applied.map((change) => change.path)),
        )) > 0;
      }
      const cachedOfficialSessionFiles = targetProvider === "openai"
        ? await persistOfficialMessageScanCache(codexHome, inspectedFiles, new Set(applied.map((change) => change.path)))
        : 0;
      const cachedOfficialSessionBytes = targetProvider === "openai"
        ? await officialMessageScanCacheBytes(codexHome)
        : 0;
      onProgress?.({
        phase: "complete",
        completed: fileEntries.length,
        total: fileEntries.length,
        processedBytes: totalBytes,
        totalBytes,
        ...officialProgressDetails,
      });
      return {
        targetProvider,
        targetModel: normalizedTargetModel,
        changedSessionFiles: applied.length,
        sqliteRowsUpdated,
        modelRowsUpdated,
        skippedSessionFiles,
        backupDir: backup.backupDir,
        encryptedContentFiles,
        sanitizedMessageIds,
        processedBytes: totalBytes,
        scannedOfficialSessionBytes: officialScannedBytes,
        officialScanTotalBytes: scanTotalBytes,
        officialScanFiles: officialPlan.files,
        cachedOfficialSessionBytes,
        cachedOfficialSessionFiles,
      };
    } catch (error) {
      for (const change of applied.reverse()) {
        const rollbackReplacements = change.replacements.map((item) => ({
          lineNumber: item.lineNumber,
          expectedLine: item.nextLine,
          nextLine: item.expectedLine,
        }));
        await replaceExpectedLines(change.path, rollbackReplacements, change.originalMtime).catch(() => {});
      }
      await restoreDatabases(codexHome, databases, backup.databaseFiles).catch(() => {});
      if (officialCacheHeaderSyncUpdated) {
        await writeOfficialMessageScanCache(codexHome, officialScanCache.files).catch(() => {});
      }
      throw error;
    }
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function databaseMainPath(file) {
  return file.replace(/-(?:wal|shm|journal)$/i, "");
}

export async function restoreProviderMetadata({ codexHome, backupDir }) {
  const backupRoot = path.join(codexHome, "backups_state", "codex-galaxy-provider-sync");
  if (!backupDir || !pathInside(backupRoot, backupDir)) throw new Error("Provider 备份路径无效。");
  const [manifestText, metadataText] = await Promise.all([
    fs.readFile(path.join(backupDir, "session-meta-backup.json"), "utf8"),
    fs.readFile(path.join(backupDir, "metadata.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const metadata = JSON.parse(metadataText);
  if (!Array.isArray(manifest) || metadata?.namespace !== "codex-galaxy-provider-sync") throw new Error("Provider 备份格式无效。");

  let restoredSessionFiles = 0;
  for (const item of manifest) {
    const sessionPath = path.resolve(String(item.path || ""));
    if (!pathInside(codexHome, sessionPath)) throw new Error("会话元数据备份路径无效。");
    let replacements;
    if (Array.isArray(item.lineBackups)) {
      replacements = item.lineBackups.map((entry) => {
        if (
          !Number.isInteger(entry?.lineNumber)
          || entry.lineNumber < 0
          || typeof entry.originalLine !== "string"
          || typeof entry.nextLine !== "string"
        ) throw new Error("会话行备份无效。");
        return {
          lineNumber: entry.lineNumber,
          expectedLine: entry.nextLine,
          nextLine: entry.originalLine,
        };
      });
    } else {
      if (!Array.isArray(item.originalSessionMetaEntries)) throw new Error("会话元数据备份格式无效。");
      replacements = item.originalSessionMetaEntries.map((entry) => {
        if (!Number.isInteger(entry?.lineNumber) || entry.lineNumber < 0 || typeof entry.line !== "string") throw new Error("会话元数据备份无效。");
        return {
          lineNumber: entry.lineNumber,
          expectedLine: sessionMetaLineForProvider(entry.line, metadata.targetProvider),
          nextLine: entry.line,
        };
      });
    }
    if (!await replaceExpectedLines(sessionPath, replacements)) throw new Error("会话文件在恢复期间发生了变化。");
    restoredSessionFiles += 1;
  }

  const databaseCopies = [];
  for (const relativeBackup of metadata.databaseFiles || []) {
    const normalized = String(relativeBackup).replaceAll("/", path.sep);
    if (!normalized.startsWith(`db${path.sep}`)) throw new Error("SQLite 备份路径无效。");
    const backup = path.resolve(backupDir, normalized);
    const source = path.resolve(codexHome, normalized.slice(3));
    if (!pathInside(backupDir, backup) || !pathInside(codexHome, source)) throw new Error("SQLite 恢复路径超出 Codex 数据目录。");
    databaseCopies.push({ backup, source });
  }
  for (const database of new Set(databaseCopies.map((item) => databaseMainPath(item.source)))) {
    for (const suffix of sqliteSidecarSuffixes) await fs.rm(`${database}${suffix}`, { force: true });
  }
  for (const file of databaseCopies) {
    await fs.mkdir(path.dirname(file.source), { recursive: true });
    await fs.copyFile(file.backup, file.source);
  }
  if (Object.hasOwn(metadata, "officialMessageScanCache")) {
    const cacheState = metadata.officialMessageScanCache;
    const cacheFile = officialMessageScanCachePath(codexHome);
    if (cacheState?.existed === true) {
      if (cacheState.backup !== officialMessageScanCacheName) throw new Error("官方消息 ID 缓存备份路径无效。");
      const cacheBackup = path.resolve(backupDir, cacheState.backup);
      if (!pathInside(backupDir, cacheBackup)) throw new Error("官方消息 ID 缓存备份路径无效。");
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.copyFile(cacheBackup, cacheFile);
    } else if (cacheState?.existed === false) {
      await fs.rm(cacheFile, { force: true });
    } else {
      throw new Error("官方消息 ID 缓存备份格式无效。");
    }
  }
  return { restoredSessionFiles, restoredDatabaseFiles: databaseCopies.length };
}
