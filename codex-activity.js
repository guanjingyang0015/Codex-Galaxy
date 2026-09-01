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
