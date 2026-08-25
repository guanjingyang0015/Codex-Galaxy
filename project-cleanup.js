import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { readJson, writeJson } from "./vault.js";

const STATE_TABLES = [
  { table: "thread_dynamic_tools", columns: ["thread_id"] },
  { table: "thread_spawn_edges", columns: ["parent_thread_id", "child_thread_id"] },
  { table: "agent_job_items", columns: ["assigned_thread_id"], action: "clear" },
  { table: "threads", columns: ["id"] },
];
const DESKTOP_TABLES = [
  { table: "local_thread_catalog", columns: ["thread_id"] },
  { table: "thread_timeline_ledger", columns: ["thread_id"] },
  { table: "automation_runs", columns: ["thread_id"] },
  { table: "inbox_items", columns: ["thread_id"] },
];
const HISTORY_TABLES = [
  { table: "thread_history_projection_state", columns: ["thread_id"] },
  { table: "thread_items", columns: ["thread_id"] },
  { table: "thread_turns", columns: ["thread_id"] },
];
const SUPPORTED_LOCAL_SOURCES = new Set(["vscode", "codex", "desktop"]);

function inside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function timestamp() {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

async function existingFile(file) {
  return fs.stat(file).then((stat) => stat.isFile() ? stat : null).catch(() => null);
}

async function walkFiles(directory, result = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(full, result);
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function sessionIdFromFile(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
  if (match) return match[1];
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
    const record = JSON.parse(firstLine);
    const id = record?.type === "session_meta" ? record.payload?.id : record?.thread_id || record?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// A live thread may be forked from an archived/deleted thread. Codex keeps
// that relationship in the session metadata/history base and still needs the
// source rollout when loading paginated history. Treat those source ids as
// protected even when the source thread itself is no longer visible.
async function lineageIdsFromFile(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
    const record = JSON.parse(firstLine);
    if (record?.type !== "session_meta" || !record.payload || typeof record.payload !== "object") return [];
    const payload = record.payload;
    const ids = [];
    for (const key of ["forked_from_id", "forkedFromId", "parent_thread_id", "parentThreadId"]) {
      if (payload[key]) ids.push(String(payload[key]));
    }
    for (const value of [payload.history_base, payload.historyBase, payload.lineage]) {
      if (!value || typeof value !== "object") continue;
      for (const key of ["thread_id", "threadId", "source_thread_id", "sourceThreadId"]) {
        if (value[key]) ids.push(String(value[key]));
      }
    }
    return [...new Set(ids)];
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function activeLineageIds(codexHome) {
  const files = (await walkFiles(path.join(codexHome, "sessions"))).filter((file) => /\.jsonl$/i.test(file));
  const ids = new Set();
  for (const file of files) {
    for (const id of await lineageIdsFromFile(file)) ids.add(id);
  }
  return ids;
}

async function databaseModule() {
  try {
    return (await import("node:sqlite")).DatabaseSync;
  } catch {
    return null;
  }
}

async function databasePaths(codexHome) {
  const paths = [];
  const rootEntries = await fs.readdir(codexHome, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (/^state(?:_\d+)?\.sqlite$/i.test(entry.name) || /^thread_history(?:_\d+)?\.sqlite$/i.test(entry.name)) {
      paths.push(path.join(codexHome, entry.name));
    }
  }
  const sqliteRoot = path.join(codexHome, "sqlite");
  const sqliteEntries = await fs.readdir(sqliteRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of sqliteEntries) {
    if (entry.isFile() && /\.(?:sqlite|db)$/i.test(entry.name)) paths.push(path.join(sqliteRoot, entry.name));
  }
  return [...new Set(paths)];
}

function tableDefinitions(databasePath) {
  const name = path.basename(databasePath).toLowerCase();
  if (/^thread_history(?:_\d+)?\.sqlite$/.test(name)) return HISTORY_TABLES;
  if (name === "codex-dev.db") return DESKTOP_TABLES;
  return STATE_TABLES;
}

function chunks(values, size = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function matchingWhere(columns, count) {
  const placeholders = Array.from({ length: count }, () => "?").join(",");
  return columns.map((column) => `"${column}" in (${placeholders})`).join(" or ");
}

function matchingArgs(ids, columns) {
  return columns.flatMap(() => ids);
}

function countRows(db, definitions, targetIds) {
  const tables = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
  const counts = [];
  for (const definition of definitions) {
    if (!tables.has(definition.table)) continue;
    const available = new Set(db.prepare(`pragma table_info("${definition.table}")`).all().map((row) => row.name));
    const columns = definition.columns.filter((column) => available.has(column));
    if (!columns.length) continue;
    let rows = 0;
    for (const group of chunks(targetIds)) {
      const where = matchingWhere(columns, group.length);
      rows += Number(db.prepare(`select count(*) as count from "${definition.table}" where ${where}`).get(...matchingArgs(group, columns)).count);
    }
    if (rows) counts.push({ table: definition.table, rows });
  }
  return counts;
}

function deleteRows(db, definitions, targetIds) {
  const tables = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
  let deleted = 0;
  for (const definition of definitions) {
    if (!tables.has(definition.table)) continue;
    const available = new Set(db.prepare(`pragma table_info("${definition.table}")`).all().map((row) => row.name));
    const columns = definition.columns.filter((column) => available.has(column));
    if (!columns.length) continue;
    for (const group of chunks(targetIds)) {
      const where = matchingWhere(columns, group.length);
      const statement = definition.action === "clear"
        ? `update "${definition.table}" set "${columns[0]}" = null where ${where}`
        : `delete from "${definition.table}" where ${where}`;
      deleted += Number(db.prepare(statement).run(...matchingArgs(group, columns)).changes || 0);
    }
  }
  return deleted;
}

async function discoverInvalidProjects(codexHome, libraryFile) {
  const DatabaseSync = await databaseModule();
  if (!DatabaseSync) throw new Error("当前运行环境不支持安全读取 Codex SQLite 数据库。");
  const rootState = path.join(codexHome, "state_5.sqlite");
  const protectedIds = new Set();
  const archivedIds = new Set();
  const deletedIds = new Set();
  const rolloutPaths = new Map();
  const lineageProtectedIds = await activeLineageIds(codexHome);
  for (const id of lineageProtectedIds) protectedIds.add(id);
  let rootDb;
  try { rootDb = new DatabaseSync(rootState, { readOnly: true }); } catch { rootDb = null; }
  if (rootDb) {
    try {
      const tables = new Set(rootDb.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
      if (tables.has("threads")) {
        const columns = new Set(rootDb.prepare('pragma table_info("threads")').all().map((row) => row.name));
        const archivedExpression = columns.has("archived") ? "coalesce(archived, 0)" : "0";
        const rolloutExpression = columns.has("rollout_path") ? "rollout_path" : "null";
        for (const row of rootDb.prepare(`select id, ${archivedExpression} as archived, ${rolloutExpression} as rollout_path from threads`).all()) {
          const id = String(row.id || "");
          if (!id) continue;
          if (Number(row.archived)) {
            archivedIds.add(id);
            if (row.rollout_path) rolloutPaths.set(id, String(row.rollout_path));
          } else {
            protectedIds.add(id);
          }
        }
      }
    } finally {
      rootDb.close();
    }
  }

  const archivedRoot = path.join(codexHome, "archived_sessions");
  const archivedFiles = (await walkFiles(archivedRoot)).filter((file) => /\.jsonl$/i.test(file));
  const fileIds = new Map();
  for (const file of archivedFiles) {
    const id = await sessionIdFromFile(file);
    if (!id || protectedIds.has(id)) continue;
    archivedIds.add(id);
    fileIds.set(id, file);
  }

  const desktopDbPath = path.join(codexHome, "sqlite", "codex-dev.db");
  let desktopDb;
  try { desktopDb = new DatabaseSync(desktopDbPath, { readOnly: true }); } catch { desktopDb = null; }
  if (desktopDb) {
    try {
      const tables = new Set(desktopDb.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
      if (tables.has("local_thread_catalog")) {
        const columns = new Set(desktopDb.prepare('pragma table_info("local_thread_catalog")').all().map((row) => row.name));
        if (columns.has("thread_id") && columns.has("missing_candidate")) {
          const source = columns.has("source_kind") ? "source_kind" : "''";
          for (const row of desktopDb.prepare(`select thread_id, ${source} as source_kind from local_thread_catalog where coalesce(missing_candidate, 0) = 1`).all()) {
            const id = String(row.thread_id || "");
            if (id && !protectedIds.has(id) && SUPPORTED_LOCAL_SOURCES.has(String(row.source_kind || "").toLowerCase())) deletedIds.add(id);
          }
        }
      }
    } finally {
      desktopDb.close();
    }
  }

  const targetIds = new Set([...archivedIds, ...deletedIds].filter((id) => !protectedIds.has(id)));
  const targetFiles = new Map();
  for (const [id, file] of fileIds) if (targetIds.has(id)) targetFiles.set(file, id);
  for (const [id, value] of rolloutPaths) {
    if (!targetIds.has(id)) continue;
    const file = path.isAbsolute(value) ? value : path.join(codexHome, value);
    if (inside(codexHome, file) && await existingFile(file)) targetFiles.set(file, id);
  }

  const files = [];
  let bytes = 0;
  for (const [file, id] of targetFiles) {
    const stat = await existingFile(file);
    if (!stat) continue;
    files.push({ path: file, id, bytes: stat.size });
    bytes += stat.size;
  }

  const databases = [];
  let databaseRows = 0;
  for (const databasePath of await databasePaths(codexHome)) {
    let db;
    try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { continue; }
    try {
      const tables = countRows(db, tableDefinitions(databasePath), [...targetIds]);
      const rows = tables.reduce((sum, item) => sum + item.rows, 0);
      if (rows) {
        databases.push({ path: databasePath, tables, rows });
        databaseRows += rows;
      }
    } finally {
      db.close();
    }
  }

  const sessionIndex = path.join(codexHome, "session_index.jsonl");
  const indexLines = await fs.readFile(sessionIndex, "utf8").then((text) => text.split(/\r?\n/).filter(Boolean)).catch(() => []);
  let indexRows = 0;
  for (const line of indexLines) {
    try {
      const row = JSON.parse(line);
      if (targetIds.has(String(row.id || row.thread_id || ""))) indexRows += 1;
    } catch {}
  }
  const library = await readJson(libraryFile, { threads: [] });
  const libraryRows = (library.threads || []).filter((thread) => targetIds.has(String(thread.id))).length;

  return {
    targetIds,
    protectedIds,
    lineageProtectedIds,
    files,
    databases,
    sessionIndex,
    indexLines,
    library,
    preview: {
      projects: targetIds.size,
      archivedProjects: [...targetIds].filter((id) => archivedIds.has(id)).length,
      deletedProjects: [...targetIds].filter((id) => deletedIds.has(id) && !archivedIds.has(id)).length,
      lineageProtectedProjects: [...lineageProtectedIds].filter((id) => archivedIds.has(id)).length,
      files: files.length,
      bytes,
      databaseRows,
      indexRows,
      libraryRows,
    },
  };
}

async function copyDatabaseSet(codexHome, backupDir, databasePath) {
  const backups = [];
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const source = `${databasePath}${suffix}`;
    if (!await existingFile(source)) continue;
    const relative = path.relative(codexHome, source);
    const destination = path.join(backupDir, "databases", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    backups.push({ source: relative, backup: path.relative(backupDir, destination) });
  }
  return backups;
}

async function rewriteJsonLines(file, lines, targetIds) {
  const kept = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (targetIds.has(String(row.id || row.thread_id || ""))) continue;
    } catch {}
    kept.push(line);
  }
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, kept.length ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function removeEmptyParents(files, stopDirectory) {
  const directories = [...new Set(files.map((file) => path.dirname(file)))].sort((a, b) => b.length - a.length);
  for (const start of directories) {
    let current = start;
    while (inside(stopDirectory, current)) {
      await fs.rmdir(current).catch(() => {});
      current = path.dirname(current);
    }
  }
}

export async function previewInvalidProjects(codexHome, libraryFile) {
  return (await discoverInvalidProjects(codexHome, libraryFile)).preview;
}

export async function cleanupInvalidProjects(codexHome, libraryFile, { onProgress = null } = {}) {
  const discovered = await discoverInvalidProjects(codexHome, libraryFile);
  const { targetIds, files, databases, indexLines, sessionIndex, library, preview } = discovered;
  if (!targetIds.size) return { ...preview, deletedRows: 0, backupDir: null };

  const backupDir = path.join(codexHome, "backups_state", "codex-galaxy-project-cleanup", timestamp());
  await fs.mkdir(backupDir, { recursive: true });
  const total = preview.bytes + databases.length + files.length + 4;
  let completed = 0;
  const report = (phase, detail = {}) => onProgress?.({ phase, completed, total, ...detail });
  report("backup");

  const databaseBackups = [];
  for (const database of databases) {
    databaseBackups.push(...await copyDatabaseSet(codexHome, backupDir, database.path));
    completed += 1;
    report("backup", { current: path.basename(database.path) });
  }
  for (const source of [sessionIndex, libraryFile]) {
    if (!await existingFile(source)) continue;
    const relative = source === libraryFile ? path.join("galaxy", path.basename(source)) : path.relative(codexHome, source);
    const destination = path.join(backupDir, "metadata", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  const archivedBackups = [];
  for (const item of files) {
    const relative = path.relative(codexHome, item.path);
    const destination = path.join(backupDir, "sessions", `${relative}.gz`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let processed = 0;
    const input = fsSync.createReadStream(item.path);
    input.on("data", (chunk) => {
      processed += chunk.length;
      report("compress", { current: path.basename(item.path), bytesCompleted: completed + processed, bytesTotal: preview.bytes });
    });
    await pipeline(input, createGzip({ level: 6 }), fsSync.createWriteStream(destination, { mode: 0o600 }));
    completed += item.bytes;
    archivedBackups.push({ id: item.id, source: relative, backup: path.relative(backupDir, destination), bytes: item.bytes });
    report("compress", { current: path.basename(item.path), bytesCompleted: completed, bytesTotal: preview.bytes });
  }

  const DatabaseSync = await databaseModule();
  let deletedRows = 0;
  for (const database of databases) {
    const db = new DatabaseSync(database.path);
    try {
      db.exec("begin immediate");
      deletedRows += deleteRows(db, tableDefinitions(database.path), [...targetIds]);
      db.exec("commit");
    } catch (error) {
      try { db.exec("rollback"); } catch {}
      throw error;
    } finally {
      db.close();
    }
    completed += 1;
    report("database", { current: path.basename(database.path) });
  }

  await rewriteJsonLines(sessionIndex, indexLines, targetIds);
  completed += 1;
  report("index");
  await writeJson(libraryFile, {
    ...library,
    catalogVersion: Math.max(Number(library.catalogVersion || 1), 4),
    syncedAt: new Date().toISOString(),
    threads: (library.threads || []).filter((thread) => !targetIds.has(String(thread.id))),
  });
  completed += 1;
  report("library");

  for (const item of files) {
    await fs.rm(item.path, { force: true });
    completed += 1;
    report("remove", { current: path.basename(item.path) });
  }
  await removeEmptyParents(files.map((item) => item.path), path.join(codexHome, "archived_sessions"));

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    projectCount: targetIds.size,
    archivedProjects: preview.archivedProjects,
    deletedProjects: preview.deletedProjects,
    deletedDatabaseRows: deletedRows,
    removedIndexRows: preview.indexRows,
    removedLibraryRows: preview.libraryRows,
    databaseBackups,
    archivedSessionBackups: archivedBackups,
    restoreNote: "Close Codex and Codex Galaxy before restoring database/metadata backups. Session .gz files must be decompressed to their original relative paths.",
  };
  await fs.writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  completed = total;
  report("complete");
  return { ...preview, deletedRows, backupDir };
}
