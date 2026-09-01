import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "./vault.js";

const ignored = new Set(["node_modules", ".git", "cache", "tmp", ".tmp", "backups", "backups_state"]);
export const THREAD_LIBRARY_CATALOG_VERSION = 5;

async function walk(directory, result = []) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, result);
    else if (/\.(jsonl|json)$/i.test(entry.name)) result.push(full);
  }
  return result;
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return textOf(value.text || value.content || value.message || value.body || "");
}

function messageFingerprint(message) {
  return message?.fingerprint
    || crypto.createHash("sha1").update(`${message?.role || "event"}\0${message?.content || ""}`).digest("hex");
}

function mergeMessages(target, additions) {
  const seen = new Set(target.map(messageFingerprint));
  for (const message of additions) {
    const fingerprint = messageFingerprint(message);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    target.push({ ...message, fingerprint });
  }
  return target;
}

function sortMessages(messages) {
  return messages
    .map((message, index) => ({ message, index, time: Date.parse(String(message.timestamp || "")) }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : null;
      const rightTime = Number.isFinite(right.time) ? right.time : null;
      if (leftTime === null && rightTime === null) return left.index - right.index;
      if (leftTime === null) return 1;
      if (rightTime === null) return -1;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ message }) => message);
}

function parseRecord(record, source) {
  if (record.type === "session_meta") return null;
  const message = record.message || record;
  const role = record.role || message.role || record.payload?.role || record.type || record.payload?.type || "event";
  const content = textOf(record.content ?? message.content ?? record.text ?? message.text ?? record.payload?.message ?? record.payload?.content);
  const id = record.thread_id || record.threadId || record.conversation_id || record.id || record.payload?.thread_id || record.payload?.threadId || null;
  if (!id || !content) return null;
  return {
    id: String(id),
    role: String(role).toLowerCase().includes("user") ? "user" : String(role).toLowerCase().includes("assistant") || String(role).toLowerCase().includes("agent") ? "assistant" : "event",
    content: content.slice(0, 12000),
    timestamp: record.timestamp || record.created_at || record.createdAt || record.payload?.timestamp || null,
    source,
  };
}

export async function syncConversations({ codexHome, libraryFile, accountId, onProgress = null }) {
  const historyMessages = await readThreadHistoryMessages(codexHome);
  const catalog = await readThreadCatalog(codexHome, new Set(historyMessages.keys()));
  const files = catalog.length ? catalog.map((item) => item.source).filter(Boolean) : await walk(path.join(codexHome, "sessions"));
  const index = await readJsonLines(path.join(codexHome, "session_index.jsonl"));
  const prior = await readJson(libraryFile, { version: 2, threads: [] });
  if (!catalog.length && !files.length && !historyMessages.size && Array.isArray(prior.threads)) {
    const syncedAt = prior.syncedAt || null;
    onProgress?.({ phase: "write", completed: 0, total: 0 });
    onProgress?.({ phase: "complete", completed: prior.threads.length, total: prior.threads.length });
    return { files: 0, imported: 0, threads: prior.threads.length, latestThreadId: prior.threads[0]?.id || null, removed: 0, syncedAt, preservedExisting: true };
  }
  const priorById = new Map(prior.threads.map((thread) => [thread.id, thread]));
  const byId = new Map();
  const total = catalog.length + index.length + (catalog.length ? 0 : files.length);
  let completed = 0;
  const report = (phase = "scan") => onProgress?.({ phase, completed, total });
  report();
  for (const item of catalog) {
    const previous = priorById.get(item.id);
    const existing = previous
      ? { ...previous, messages: [...(previous.messages || [])], accounts: [...(previous.accounts || [])] }
      : { id: item.id, title: item.title || "未命名线程", project: item.cwd || null, cwd: item.cwd || null, provider: item.provider || null, messages: [], accounts: [], updatedAt: item.updatedAt, source: item.source };
    existing.title = item.title || existing.title;
    existing.cwd = item.cwd || existing.cwd;
    existing.project = item.cwd || existing.project;
    existing.provider = item.provider || existing.provider;
    existing.updatedAt = item.updatedAt || existing.updatedAt;
    existing.source = item.source || existing.source;
    if (accountId && !existing.accounts.includes(accountId)) existing.accounts.push(accountId);
    byId.set(item.id, existing);
    completed += 1;
    report();
  }
  // Desktop Codex keeps some recent conversations in thread_history SQLite
  // without a rollout_path. Merge those user/assistant items so Galaxy can show
  // the same current chat instead of an empty metadata-only row.
  for (const [id, messages] of historyMessages) {
    const item = catalog.find((candidate) => candidate.id === id);
    const previous = byId.get(id) || priorById.get(id);
    if (!previous && !item) continue;
    const existing = previous
      ? { ...previous, messages: [...(previous.messages || [])], accounts: [...(previous.accounts || [])] }
      : { id, title: item?.title || "未命名线程", project: item?.cwd || null, cwd: item?.cwd || null, provider: item?.provider || null, messages: [], accounts: [], updatedAt: item?.updatedAt || null, source: item?.source || null };
    for (const message of messages) {
      if (!existing.messages.some((candidate) => candidate.fingerprint === message.fingerprint)) existing.messages.push(message);
      existing.updatedAt = message.timestamp || existing.updatedAt;
    }
    if (accountId && !existing.accounts.includes(accountId)) existing.accounts.push(accountId);
    byId.set(id, existing);
  }
  let imported = 0;

  if (!catalog.length) for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      completed += 1;
      report();
      continue;
    }
    const lines = content.split(/\r?\n/).filter(Boolean);
    let session = { id: null, title: null, cwd: null, provider: null, startedAt: null };
    for (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type === "session_meta" && record.payload) {
        session = {
          id: record.payload.id || session.id,
          title: record.payload.thread_name || record.payload.title || session.title,
          cwd: record.payload.cwd || session.cwd,
          provider: record.payload.model_provider || session.provider,
          startedAt: record.payload.timestamp || session.startedAt,
        };
        if (session.id) {
          const id = String(session.id);
          const previous = byId.get(id) || priorById.get(id);
          const active = previous
            ? { ...previous, messages: [...(previous.messages || [])], accounts: [...(previous.accounts || [])] }
            : { id, title: session.title || "未命名线程", project: session.cwd || null, cwd: session.cwd || null, provider: session.provider || null, messages: [], accounts: [], updatedAt: session.startedAt, source: file };
          active.title = session.title || active.title || "未命名线程";
          active.cwd = session.cwd || active.cwd;
          active.project = session.cwd || active.project;
          active.provider = session.provider || active.provider;
          active.source = file;
          active.updatedAt = active.updatedAt || session.startedAt;
          if (accountId && !active.accounts.includes(accountId)) active.accounts.push(accountId);
          byId.set(id, active);
        }
        continue;
      }
      const parsed = parseRecord({ ...record, id: record.id || session.id, thread_id: record.thread_id || session.id }, file);
      if (!parsed) continue;
      const previous = byId.get(parsed.id) || priorById.get(parsed.id);
      const existing = previous
        ? { ...previous, messages: [...(previous.messages || [])], accounts: [...(previous.accounts || [])] }
        : {
            id: parsed.id,
            title: session.title || parsed.content.replace(/\s+/g, " ").slice(0, 80),
            project: record.payload?.cwd || record.cwd || session.cwd || null,
            cwd: record.payload?.cwd || record.cwd || session.cwd || null,
            provider: session.provider,
            messages: [],
            accounts: [],
            updatedAt: parsed.timestamp || new Date().toISOString(),
            source: file,
          };
      const fingerprint = crypto.createHash("sha1").update(`${parsed.role}\0${parsed.content}`).digest("hex");
      if (!existing.messages.some((item) => item.fingerprint === fingerprint)) {
        existing.messages.push({ ...parsed, fingerprint });
        imported += 1;
      }
      if (accountId && !existing.accounts.includes(accountId)) existing.accounts.push(accountId);
      existing.updatedAt = parsed.timestamp || existing.updatedAt;
      existing.source = file;
      if (!existing.cwd && record.payload?.cwd) existing.cwd = record.payload.cwd;
      byId.set(parsed.id, existing);
    }
    completed += 1;
    report();
  }

  for (const item of index) {
    const id = item.id || item.thread_id;
    const existing = id ? byId.get(String(id)) : null;
    if (existing) {
      existing.title = item.thread_name || item.title || existing.title || "未命名线程";
      existing.updatedAt = item.updated_at || existing.updatedAt;
    }
    completed += 1;
    report();
  }

  const threads = [...byId.values()]
    .map((thread) => ({ ...thread, messages: thread.messages.slice(-200) }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const removed = prior.threads.filter((thread) => !byId.has(thread.id)).length;
  report("write");
  const syncedAt = new Date().toISOString();
  await writeJson(libraryFile, { version: 2, catalogVersion: THREAD_LIBRARY_CATALOG_VERSION, syncedAt, threads });
  report("complete");
  return { files: files.length, imported, threads: threads.length, latestThreadId: threads[0]?.id || null, removed, syncedAt };
}

async function readThreadCatalog(codexHome, historyThreadIds = new Set()) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return []; }
  const byId = new Map();
  const archivedIds = new Set();
  let authoritativeRoot = false;

  const readThreads = (databasePath, { authoritative = false } = {}) => {
    let db;
    try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { return false; }
    try {
      const tables = db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name);
      if (!tables.includes("threads")) return false;
      const table = "threads";
      const columns = db.prepare('pragma table_info("threads")').all().map((row) => row.name);
      if (!columns.includes("id")) return false;
      const pick = (column, fallback) => columns.includes(column) ? `"${column}"` : fallback;
      const filters = [];
      if (columns.includes("archived")) {
        filters.push("coalesce(archived, 0) = 0");
        if (authoritative) {
          for (const row of db.prepare("select id from threads where coalesce(archived, 0) != 0").all()) {
            if (row.id) archivedIds.add(String(row.id));
          }
        }
      }
      if (columns.includes("thread_source")) filters.push("lower(coalesce(thread_source, '')) not in ('subagent', 'sub_agent', 'internal')");
      const where = filters.length ? ` where ${filters.join(" and ")}` : "";
      const updated = pick("updated_at_ms", pick("updated_at", "0"));
      const rows = db.prepare(`select "id" as id, ${pick("title", "''")} as title, ${pick("cwd", "''")} as cwd, ${pick("model_provider", "''")} as provider, ${pick("rollout_path", "''")} as rollout_path, ${pick("has_user_event", "0")} as has_user_event, ${pick("thread_source", "''")} as thread_source, ${updated} as updated_at from "threads"${where}`).all();
      for (const row of rows) {
        const id = String(row.id || "").trim();
        if (!id) continue;
        const source = String(row.thread_source || "").trim().toLowerCase();
        const hasHistory = historyThreadIds.has(id);
        if (Number(row.has_user_event || 0) !== 1 && (!hasHistory || ["automation", "subagent", "sub_agent", "internal", "guardian_review"].includes(source))) continue;
        const candidate = {
          id,
          title: row.title || "未命名线程",
          cwd: row.cwd || null,
          provider: row.provider || null,
          updatedAt: row.updated_at ? new Date(Number(row.updated_at) < 10_000_000_000 ? Number(row.updated_at) * 1000 : Number(row.updated_at)).toISOString() : null,
          source: resolveRolloutPath(codexHome, row.rollout_path),
        };
        const previous = byId.get(id);
        if (!previous || (!previous.source && candidate.source) || authoritative) {
          byId.set(id, { ...candidate, sourceTable: authoritative ? "root_threads" : "legacy_threads" });
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      db.close();
    }
  };

  authoritativeRoot = readThreads(path.join(codexHome, "state_5.sqlite"), { authoritative: true });
  // Older Codex builds stored the only threads table in sqlite/state_5.sqlite.
  // Once the modern root database exists, that nested copy is historical and
  // must not revive projects that the root database archived or removed.
  if (!authoritativeRoot) readThreads(path.join(codexHome, "sqlite", "state_5.sqlite"));

  const catalogPath = path.join(codexHome, "sqlite", "codex-dev.db");
  let catalogDb;
  try { catalogDb = new DatabaseSync(catalogPath, { readOnly: true }); } catch { catalogDb = null; }
  if (catalogDb) {
    try {
      const tables = catalogDb.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name);
      if (tables.includes("local_thread_catalog")) {
        const table = "local_thread_catalog";
        const columns = catalogDb.prepare(`pragma table_info("${table}")`).all().map((row) => row.name);
        if (columns.includes("thread_id")) {
          const pick = (column, fallback) => columns.includes(column) ? `"${column}"` : fallback;
          const filters = [];
          if (columns.includes("missing_candidate")) filters.push("coalesce(missing_candidate, 0) = 0");
          if (columns.includes("source_kind")) filters.push("lower(coalesce(source_kind, '')) in ('vscode', 'codex', 'desktop')");
          if (columns.includes("thread_source")) filters.push("lower(coalesce(thread_source, '')) not in ('subagent', 'sub_agent', 'internal')");
          const where = filters.length ? ` where ${filters.join(" and ")}` : "";
          const rows = catalogDb.prepare(`select "thread_id" as id, ${pick("display_title", "''")} as title, ${pick("cwd", "''")} as cwd, ${pick("model_provider", "''")} as provider, ${pick("source_updated_at", "0")} as updated_at from "${table}"${where}`).all();
          for (const row of rows) {
            const id = String(row.id || "").trim();
            if (!id || archivedIds.has(id)) continue;
            const previous = byId.get(id);
            // The desktop catalog is only a metadata projection. When a modern
            // root database exists, require real projected messages before using
            // a catalog-only row so stale catalog entries cannot inflate the list.
            if (!previous && authoritativeRoot && !historyThreadIds.has(id)) continue;
            const candidate = {
              id,
              title: row.title || previous?.title || "未命名线程",
              cwd: row.cwd || previous?.cwd || null,
              provider: row.provider || previous?.provider || null,
              updatedAt: row.updated_at ? new Date(Number(row.updated_at) < 10_000_000_000 ? Number(row.updated_at) * 1000 : Number(row.updated_at)).toISOString() : previous?.updatedAt || null,
              source: previous?.source || null,
            };
            if (!previous) byId.set(id, { ...candidate, sourceTable: "local_thread_catalog" });
          }
        }
      }
    } catch {
      // The desktop projection is supplemental; a partial migration is non-fatal.
    } finally {
      catalogDb.close();
    }
  }
  return [...byId.values()].map(({ sourceTable, ...item }) => item).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function resolveRolloutPath(codexHome, value) {
  if (!value) return null;
  const rawValue = String(value);
  const isExtendedWindowsPath = /^\\\\\?\\/i.test(rawValue);
  const candidate = isExtendedWindowsPath || path.isAbsolute(rawValue)
    ? rawValue
    : path.join(codexHome, rawValue);
  const stripExtendedPrefix = (input) => {
    if (process.platform !== "win32") return input;
    if (/^\\\\\?\\UNC\\/i.test(input)) return `\\\\${input.slice(8)}`;
    return input.replace(/^\\\\\?\\/i, "");
  };
  const root = path.resolve(stripExtendedPrefix(String(codexHome)));
  const normalizedCandidate = path.resolve(stripExtendedPrefix(candidate));
  const relative = path.relative(root, normalizedCandidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? normalizedCandidate : null;
}

export async function readThreadDetail(thread, codexHome) {
  if (!thread.source) {
    const messages = (await readThreadHistoryMessages(codexHome)).get(String(thread.id)) || [];
    return { ...thread, messages: sortMessages(messages), compatibility: { encryptedContent: false } };
  }
  let content;
  try { content = await fs.readFile(thread.source, "utf8"); } catch { return thread; }
  const messages = [];
  let session = { id: thread.id, cwd: thread.cwd, provider: thread.provider };
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type === "session_meta" && record.payload) {
      session = { id: record.payload.id || session.id, cwd: record.payload.cwd || session.cwd, provider: record.payload.model_provider || session.provider };
      continue;
    }
    const parsed = parseRecord({ ...record, id: record.id || session.id, thread_id: record.thread_id || session.id }, thread.source);
    if (parsed) messages.push({ ...parsed, fingerprint: messageFingerprint(parsed) });
  }
  // Desktop history can contain items that have not yet been flushed to the
  // rollout file. Merge it into the detail view so reopening Galaxy does not
  // make a partially written rollout look like lost chat history.
  const history = (await readThreadHistoryMessages(codexHome)).get(String(thread.id)) || [];
  mergeMessages(messages, history);
  return {
    ...thread,
    cwd: session.cwd,
    provider: session.provider,
    messages: sortMessages(messages),
    compatibility: { encryptedContent: content.includes('"encrypted_content"') },
  };
}

async function readThreadHistoryMessages(codexHome) {
  const result = new Map();
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return result; }
  const entries = await fs.readdir(codexHome, { withFileTypes: true }).catch(() => []);
  const databases = entries.filter((entry) => entry.isFile() && /^thread_history(?:_\d+)?\.sqlite$/i.test(entry.name)).map((entry) => path.join(codexHome, entry.name));
  for (const databasePath of databases) {
    let db;
    try { db = new DatabaseSync(databasePath, { readOnly: true }); } catch { continue; }
    try {
      const columns = db.prepare("pragma table_info(thread_items)").all().map((row) => row.name);
      if (!columns.includes("thread_id") || !columns.includes("item_json")) continue;
      const rows = db.prepare("select thread_id, item_json, item_type, created_at_ms from thread_items order by created_at_ms asc").all();
      for (const row of rows) {
        let item;
        try { item = JSON.parse(row.item_json); } catch { continue; }
        const type = String(item?.type || row.item_type || "").toLowerCase();
        const role = type.includes("user") ? "user" : type.includes("assistant") || type.includes("agent") ? "assistant" : null;
        if (!role) continue;
        const content = textOf(item.content ?? item.message ?? item.output ?? item.text ?? item.summary);
        if (!content) continue;
        const id = String(row.thread_id || "");
        if (!id) continue;
        const timestamp = row.created_at_ms ? new Date(Number(row.created_at_ms)).toISOString() : null;
        const fingerprint = crypto.createHash("sha1").update(`${role}\0${content}`).digest("hex");
        const list = result.get(id) || [];
        if (!list.some((message) => message.fingerprint === fingerprint)) list.push({ role, content: content.slice(0, 12000), timestamp, source: databasePath, fingerprint });
        result.set(id, list);
      }
    } catch {
      // History projection is optional; rollout/metadata catalogs remain usable.
    } finally { db.close(); }
  }
  return result;
}

async function readJsonLines(file) {
  let text;
  try { text = await fs.readFile(file, "utf8"); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export async function readLibrary(libraryFile) {
  return readJson(libraryFile, { version: 2, catalogVersion: 1, threads: [], syncedAt: null });
}
