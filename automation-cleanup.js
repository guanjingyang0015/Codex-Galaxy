import fs from "node:fs/promises";
import path from "node:path";

const COMPLETED = new Set(["COMPLETED", "COMPLETE", "DONE", "SUCCESS", "SUCCEEDED", "ARCHIVED"]);
const SAFE_HISTORY_NAMES = new Set(["memory.md", "run-complete.md", "blocked.md", "report.md", "memory.md.tmp"]);
const COMPLETED_RUNS = ["ARCHIVED", "COMPLETED", "COMPLETE", "DONE", "SUCCESS", "SUCCEEDED", "FAILED", "CANCELED", "CANCELLED"];

function parseStatus(text) {
  return text.match(/^status\s*=\s*["']([^"']+)["']/mi)?.[1]?.trim().toUpperCase() || "";
}

async function candidatesForDirectory(directory) {
  const config = path.join(directory, "automation.toml");
  const status = parseStatus(await fs.readFile(config, "utf8").catch(() => ""));
  if (!COMPLETED.has(status)) return null;
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && SAFE_HISTORY_NAMES.has(entry.name)) {
      const file = path.join(directory, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile()) files.push({ path: file, bytes: stat.size });
    }
  }
  return { id: path.basename(directory), status, files, bytes: files.reduce((sum, item) => sum + item.bytes, 0) };
}

export async function previewCompletedAutomations(codexHome) {
  const root = path.join(codexHome, "automations");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const item = await candidatesForDirectory(path.join(root, entry.name));
    if (item?.files.length) items.push(item);
  }
  const databases = [];
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }
  if (DatabaseSync) {
    const databasePaths = [];
    const rootEntries = await fs.readdir(codexHome, { withFileTypes: true }).catch(() => []);
    for (const entry of rootEntries) if (entry.isFile() && /^state(?:_\d+)?\.sqlite$/i.test(entry.name)) databasePaths.push(path.join(codexHome, entry.name));
    const sqliteEntries = await fs.readdir(path.join(codexHome, "sqlite"), { withFileTypes: true }).catch(() => []);
    for (const entry of sqliteEntries) if (entry.isFile() && /\.(?:sqlite|db)$/i.test(entry.name)) databasePaths.push(path.join(codexHome, "sqlite", entry.name));
    for (const databasePath of [...new Set(databasePaths)]) {
      let db;
      try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { continue; }
      try {
        const table = db.prepare("select name from sqlite_master where type='table' and name='automation_runs'").get();
        if (!table) continue;
        const placeholders = COMPLETED_RUNS.map(() => "?").join(",");
        const row = db.prepare(`select count(*) as count, coalesce(sum(length(coalesce(archived_user_message,'')) + length(coalesce(archived_assistant_message,'')) + length(coalesce(inbox_summary,''))),0) as bytes from automation_runs where upper(coalesce(status,'')) in (${placeholders})`).get(...COMPLETED_RUNS);
        if (Number(row?.count) > 0) databases.push({ path: databasePath, table: "automation_runs", rows: Number(row.count), bytes: Number(row.bytes) || 0 });
      } finally { db.close(); }
    }
  }
  return { items, files: items.flatMap((item) => item.files), databases, rows: databases.reduce((sum, item) => sum + item.rows, 0), bytes: items.reduce((sum, item) => sum + item.bytes, 0) + databases.reduce((sum, item) => sum + item.bytes, 0) };
}

export async function getAutomationSettings(settingsFile) {
  const data = await fs.readFile(settingsFile, "utf8").then((text) => JSON.parse(text)).catch(() => ({}));
  return { autoCleanCompleted: data.autoCleanCompleted === true };
}

export async function setAutomationSettings(settingsFile, patch = {}) {
  const current = await getAutomationSettings(settingsFile);
  const next = { ...current, autoCleanCompleted: patch.autoCleanCompleted === true };
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export async function cleanupCompletedAutomations(codexHome, settingsFile, { force = false } = {}) {
  const settings = await getAutomationSettings(settingsFile);
  if (!force && !settings.autoCleanCompleted) return { skipped: true, settings, files: 0, bytes: 0, backupDir: null };
  const preview = await previewCompletedAutomations(codexHome);
  if (!preview.files.length && !preview.databases.length) return { skipped: false, settings, files: 0, rows: 0, bytes: 0, backupDir: null };
  const backupDir = path.join(codexHome, "backups_state", "codex-galaxy-automation-cleanup", new Date().toISOString().replace(/[.:]/g, "-"));
  await fs.mkdir(backupDir, { recursive: true });
  for (const item of preview.files) {
    const relative = path.relative(codexHome, item.path);
    const backup = path.join(backupDir, relative);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.copyFile(item.path, backup);
    await fs.rm(item.path, { force: true });
  }
  const databaseBackups = [];
  for (const item of preview.databases) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const source = `${item.path}${suffix}`;
      if (!await fs.stat(source).then((stat) => stat.isFile()).catch(() => false)) continue;
      const relative = path.relative(codexHome, source);
      const backup = path.join(backupDir, relative);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(source, backup);
      databaseBackups.push({ source, backup });
    }
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(item.path);
    try {
      db.exec("begin immediate");
      const placeholders = COMPLETED_RUNS.map(() => "?").join(",");
      db.prepare(`delete from automation_runs where upper(coalesce(status,'')) in (${placeholders})`).run(...COMPLETED_RUNS);
      db.exec("commit");
    } catch (error) {
      try { db.exec("rollback"); } catch {}
      throw error;
    } finally { db.close(); }
  }
  await fs.writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify({ createdAt: new Date().toISOString(), files: preview.files, databases: databaseBackups, deletedAutomationRuns: preview.rows }, null, 2)}\n`, { mode: 0o600 });
  return { skipped: false, settings, files: preview.files.length, rows: preview.rows, bytes: preview.bytes, backupDir };
}
