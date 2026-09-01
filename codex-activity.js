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

// Codex can leave an `inProgress` row behind when the desktop process is
// crashed or force-terminated. A recent item/start timestamp is still
// treated as active, but an old marker must not block every future switch.
export const STALE_TURN_AFTER_MS = 30 * 60 * 1000;

function timestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function isTerminalTurn(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  return TERMINAL_TURN_STATUSES.has(status)
    || (row?.completed_at !== null && row?.completed_at !== undefined && String(row.completed_at).trim() !== "");
}

function laterTurnExists(row, turns) {
  if (!row?.thread_id) return false;
  const ordinal = Number(row.rollout_ordinal);
  const started = timestampMs(row.started_at);
  return turns.some((candidate) => {
    if (String(candidate.thread_id || "") !== String(row.thread_id)) return false;
    if (!isTerminalTurn(candidate)) return false;
    const candidateOrdinal = Number(candidate.rollout_ordinal);
    if (Number.isFinite(ordinal) && Number.isFinite(candidateOrdinal) && candidateOrdinal !== ordinal) {
      return candidateOrdinal > ordinal;
    }
    const candidateStarted = timestampMs(candidate.started_at);
    return started !== null && candidateStarted !== null && candidateStarted > started;
  });
}

function turnIsRecent(row, latestItemMs, now, staleAfterMs) {
  const started = timestampMs(row.started_at);
  const item = timestampMs(latestItemMs);
  const lastActivity = Math.max(started || 0, item || 0);
  if (!lastActivity) return true;
  return now - lastActivity <= staleAfterMs;
}

function unfinishedTurns(turns, latestItems, { now = Date.now(), staleAfterMs = STALE_TURN_AFTER_MS } = {}) {
  return turns.filter((row) => {
    if (isTerminalTurn(row)) return false;
    if (laterTurnExists(row, turns)) return false;
    return turnIsRecent(row, latestItems.get(String(row.thread_id || "")), now, staleAfterMs);
  });
}

function latestItemTimes(db, tables) {
  const result = new Map();
  for (const table of ["thread_items", "thread_realtime_items"]) {
    if (!tables.includes(table)) continue;
    const columns = db.prepare(`pragma table_info("${table}")`).all().map((row) => row.name);
    if (!columns.includes("thread_id") || !columns.includes("created_at_ms")) continue;
    for (const row of db.prepare(`select thread_id, max(created_at_ms) as latest from "${table}" group by thread_id`).all()) {
      const key = String(row.thread_id || "");
      if (!key) continue;
      const latest = timestampMs(row.latest);
      if (latest !== null) result.set(key, Math.max(result.get(key) || 0, latest));
    }
  }
  return result;
}

function readTurnRows(db, tables) {
  if (!tables.includes("thread_turns")) return null;
  const columns = db.prepare("pragma table_info(thread_turns)").all().map((row) => row.name);
  if (!columns.includes("status")) return null;
  const pick = (column) => columns.includes(column) ? `"${column}"` : "null";
  return db.prepare(`select ${pick("thread_id")} as thread_id, ${pick("rollout_ordinal")} as rollout_ordinal, "status" as status, ${pick("completed_at")} as completed_at, ${pick("started_at")} as started_at from thread_turns`).all();
}

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
      const rows = readTurnRows(db, tables);
      if (!rows) continue;
      inspected = true;
      const active = unfinishedTurns(rows, latestItemTimes(db, tables));
      if (active.length) return true;
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
      const turnRows = readTurnRows(db, tables);
      if (turnRows) {
        const active = unfinishedTurns(turnRows, new Map())
          .sort((left, right) => (timestampMs(right.started_at) || 0) - (timestampMs(left.started_at) || 0))[0];
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
