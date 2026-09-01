import fs from "node:fs/promises";
import path from "node:path";

const TERMINAL_TURN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "aborted",
  "interrupted",
  "error",
]);

export async function hasActiveCodexTurn(codexHome) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return null; }
  const entries = await fs.readdir(codexHome, { withFileTypes: true }).catch(() => []);
  const databases = entries
    .filter((entry) => entry.isFile() && /^thread_history(?:_\d+)?\.sqlite$/i.test(entry.name))
    .map((entry) => path.join(codexHome, entry.name));
  let inspected = false;
  for (const databasePath of databases) {
    let db;
    try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { continue; }
    try {
      const tables = db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name);
      if (!tables.includes("thread_turns")) continue;
      inspected = true;
      const columns = db.prepare("pragma table_info(thread_turns)").all().map((row) => row.name);
      if (!columns.includes("status")) return null;
      const completedAt = columns.includes("completed_at") ? `"completed_at"` : "null";
      const rows = db.prepare(`select "status" as status, ${completedAt} as completed_at from thread_turns`).all();
      for (const row of rows) {
        const status = String(row.status || "").trim().toLowerCase();
        if (TERMINAL_TURN_STATUSES.has(status)) continue;
        if (row.completed_at !== null && row.completed_at !== undefined && String(row.completed_at).trim()) continue;
        return true;
      }
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
  return inspected ? false : null;
}

export async function latestCodexThreadId(codexHome) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return null; }
  const databasePath = path.join(codexHome, "state_5.sqlite");
  let db;
  try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { return null; }
  try {
    const tables = db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name);
    if (!tables.includes("threads")) return null;
    const columns = db.prepare("pragma table_info(threads)").all().map((row) => row.name);
    if (!columns.includes("id")) return null;
    const source = columns.includes("thread_source") ? "lower(coalesce(thread_source, '')) not in ('automation', 'subagent', 'sub_agent', 'internal', 'guardian_review')" : "1 = 1";
    const archived = columns.includes("archived") ? "coalesce(archived, 0) = 0" : "1 = 1";
    if (tables.includes("thread_turns")) {
      const turnColumns = db.prepare("pragma table_info(thread_turns)").all().map((row) => row.name);
      if (turnColumns.includes("thread_id") && turnColumns.includes("status")) {
        const completedAt = turnColumns.includes("completed_at") ? `"completed_at" is null` : "1 = 1";
        const active = db.prepare(`select thread_id from thread_turns where lower(status) not in ('completed', 'failed', 'cancelled', 'canceled', 'aborted', 'interrupted', 'error') and ${completedAt} order by ${turnColumns.includes("started_at") ? `"started_at"` : "rowid"} desc limit 1`).get();
        if (active?.thread_id) return String(active.thread_id);
      }
    }
    const updated = columns.includes("updated_at_ms") ? `"updated_at_ms"` : columns.includes("updated_at") ? `"updated_at"` : "rowid";
    const row = db.prepare(`select id from threads where ${archived} and ${source} order by ${updated} desc limit 1`).get();
    return row?.id ? String(row.id) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
