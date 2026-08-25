import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncConversations, readLibrary } from "../sync.js";
import { readThreadDetail } from "../sync.js";

test("sync groups rollout events by session_meta thread id", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-codex-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const id = "019abcde-abcd-7abc-8abc-abcdefabcdef";
  await fs.writeFile(path.join(home, "session_index.jsonl"), JSON.stringify({ id, thread_name: "Galaxy project", updated_at: "2026-08-23T10:00:00Z" }) + "\n");
  await fs.writeFile(path.join(sessions, `rollout-2026-08-23T10-00-00-${id}.jsonl`), [
    JSON.stringify({ type: "session_meta", payload: { id, cwd: "C:\\work\\galaxy", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "继续做切换器" }] }, timestamp: "2026-08-23T10:01:00Z" }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "开始实现" }] }, timestamp: "2026-08-23T10:02:00Z" }),
  ].join("\n") + "\n");
  const libraryFile = path.join(home, "library.json");
  const progress = [];
  const result = await syncConversations({ codexHome: home, libraryFile, accountId: "relay-b", onProgress: (entry) => progress.push(entry) });
  const library = await readLibrary(libraryFile);
  assert.equal(result.threads, 1);
  assert.equal(library.threads[0].id, id);
  assert.equal(library.threads[0].title, "Galaxy project");
  assert.equal(library.threads[0].messages.length, 2);
  assert.equal(library.threads[0].accounts[0], "relay-b");
  const detail = await readThreadDetail({ ...library.threads[0], messages: [], source: path.join(sessions, `rollout-2026-08-23T10-00-00-${id}.jsonl`) }, home);
  assert.equal(detail.messages[0].role, "user");
  assert.equal(detail.messages[1].role, "assistant");
  assert.deepEqual(progress[0], { phase: "scan", completed: 0, total: 2 });
  assert.deepEqual(progress.at(-1), { phase: "complete", completed: 2, total: 2 });
});

test("sync prefers the Codex threads SQLite catalog", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-sqlite-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, title text, cwd text, model_provider text, rollout_path text, updated_at_ms integer)");
  db.prepare("insert into threads values (?, ?, ?, ?, ?, ?)").run("thread-sqlite", "SQLite project", "C:\\project", "openai", "sessions/rollout-thread-sqlite.jsonl", 1780000000000);
  db.close();
  await fs.writeFile(path.join(home, "session_index.jsonl"), `${JSON.stringify({ id: "thread-sqlite", thread_name: "Renamed in Codex", updated_at: "2026-08-24T08:00:00Z" })}\n`);
  await fs.mkdir(path.join(home, "sessions"), { recursive: true });
  await fs.writeFile(path.join(home, "sessions", "rollout-thread-sqlite.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-sqlite", cwd: "C:\\project", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "reasoning", encrypted_content: "opaque-provider-data" } }),
  ].join("\n") + "\n");
  const libraryFile = path.join(home, "library.json");
  const result = await syncConversations({ codexHome: home, libraryFile, accountId: "official-a" });
  const library = await readLibrary(libraryFile);
  assert.equal(result.files, 1);
  assert.equal(library.threads[0].title, "Renamed in Codex");
  assert.equal(library.threads[0].provider, "openai");
  const detail = await readThreadDetail(library.threads[0], home);
  assert.equal(detail.compatibility.encryptedContent, true);
});

test("sync rebuilds the library from visible Codex rows and prunes archived, deleted, and internal threads", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-visible-sqlite-"));
  const sessions = path.join(home, "sessions");
  const archivedSessions = path.join(home, "archived_sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(archivedSessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "active.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "active", model_provider: "openai" } })}\n`);
  await fs.writeFile(path.join(archivedSessions, "archived.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "archived", model_provider: "openai" } })}\n`);

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, title text, cwd text, model_provider text, rollout_path text, updated_at_ms integer, archived integer, has_user_event integer, thread_source text)");
  const insert = db.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("active", "Active project", "C:\\active", "openai", "sessions/active.jsonl", 1780000000000, 0, 1, "user");
  insert.run("archived", "Archived project", "C:\\old", "openai", "archived_sessions/archived.jsonl", 1770000000000, 1, 1, "user");
  insert.run("internal", "Internal agent", "C:\\active", "openai", "sessions/internal.jsonl", 1760000000000, 0, 1, "subagent");
  insert.run("empty", "Empty thread", "C:\\active", "openai", "sessions/empty.jsonl", 1750000000000, 0, 0, "user");
  db.close();

  await fs.writeFile(path.join(home, "session_index.jsonl"), [
    JSON.stringify({ id: "active", thread_name: "Renamed active project" }),
    JSON.stringify({ id: "archived", thread_name: "Renamed archived project" }),
    JSON.stringify({ id: "deleted", thread_name: "Deleted project" }),
  ].join("\n") + "\n");
  const libraryFile = path.join(home, "library.json");
  await fs.writeFile(libraryFile, `${JSON.stringify({
    version: 1,
    threads: [
      { id: "active", title: "Old active title", messages: [], accounts: ["official-a"] },
      { id: "archived", title: "Old archived title", messages: [], accounts: [] },
      { id: "deleted", title: "Old deleted title", messages: [], accounts: [] },
    ],
  })}\n`);

  const result = await syncConversations({ codexHome: home, libraryFile, accountId: "relay-b" });
  const library = await readLibrary(libraryFile);
  assert.equal(library.version, 2);
  assert.equal(result.threads, 1);
  assert.equal(result.removed, 2);
  assert.deepEqual(library.threads.map((thread) => thread.id), ["active"]);
  assert.equal(library.threads[0].title, "Renamed active project");
  assert.deepEqual(library.threads[0].accounts, ["official-a", "relay-b"]);
});

test("filesystem fallback reads active sessions only and never revives index-only archive rows", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-visible-files-"));
  const sessions = path.join(home, "sessions");
  const archivedSessions = path.join(home, "archived_sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(archivedSessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "active.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "active", title: "Active", model_provider: "openai" } })}\n`);
  await fs.writeFile(path.join(archivedSessions, "archived.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "archived", title: "Archived", model_provider: "openai" } })}\n`);
  await fs.writeFile(path.join(home, "session_index.jsonl"), [
    JSON.stringify({ id: "active", thread_name: "Visible active" }),
    JSON.stringify({ id: "archived", thread_name: "Hidden archive" }),
    JSON.stringify({ id: "deleted", thread_name: "Hidden deleted" }),
  ].join("\n") + "\n");
  const libraryFile = path.join(home, "library.json");
  await fs.writeFile(libraryFile, `${JSON.stringify({ version: 1, threads: [
    { id: "archived", title: "Archived", messages: [], accounts: [] },
    { id: "deleted", title: "Deleted", messages: [], accounts: [] },
  ] })}\n`);

  const result = await syncConversations({ codexHome: home, libraryFile, accountId: "official-a" });
  const library = await readLibrary(libraryFile);
  assert.equal(result.files, 1);
  assert.equal(result.threads, 1);
  assert.equal(result.removed, 2);
  assert.deepEqual(library.threads.map((thread) => thread.id), ["active"]);
  assert.equal(library.threads[0].title, "Visible active");
});

test("sync merges the desktop local thread catalog so the current Codex project is not lost", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-local-catalog-"));
  const { DatabaseSync } = await import("node:sqlite");
  const root = new DatabaseSync(path.join(home, "state_5.sqlite"));
  root.exec("create table threads (id text primary key, title text, cwd text, model_provider text, rollout_path text, updated_at_ms integer, archived integer, has_user_event integer, thread_source text)");
  root.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("root", "Root", "C:\\root", "openai", null, 1780000000000, 0, 1, "user");
  root.close();
  await fs.mkdir(path.join(home, "sqlite"), { recursive: true });
  const desktop = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"));
  desktop.exec("create table local_thread_catalog (thread_id text primary key, display_title text, cwd text, model_provider text, source_updated_at real, source_kind text, missing_candidate integer)");
  desktop.prepare("insert into local_thread_catalog values (?, ?, ?, ?, ?, ?, ?)").run("desktop-only", "当前 Codex 项目", "C:\\codex账号同步", "openai", 1787627933, "vscode", 0);
  desktop.prepare("insert into local_thread_catalog values (?, ?, ?, ?, ?, ?, ?)").run("chatgpt-only", "不应进入项目列表", null, null, 1787627933, "chatgpt", 0);
  desktop.close();
  const history = new DatabaseSync(path.join(home, "thread_history_1.sqlite"));
  history.exec("create table thread_items (thread_id text, item_json text, item_type text, created_at_ms integer)");
  history.prepare("insert into thread_items values (?, ?, ?, ?)").run("desktop-only", JSON.stringify({ type: "userMessage", content: "current project" }), "userMessage", 1787627933000);
  history.close();
  const libraryFile = path.join(home, "library.json");
  const result = await syncConversations({ codexHome: home, libraryFile });
  const library = await readLibrary(libraryFile);
  assert.equal(result.threads, 2);
  assert.ok(library.threads.some((thread) => thread.id === "desktop-only" && thread.title === "当前 Codex 项目"));
  assert.equal(library.threads.some((thread) => thread.id === "chatgpt-only"), false);
});

test("sync includes desktop thread_history messages when no rollout path exists", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-thread-history-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "thread_history_1.sqlite"));
  db.exec("create table thread_items (thread_id text, item_json text, item_type text, created_at_ms integer)");
  db.prepare("insert into thread_items values (?, ?, ?, ?)").run("desktop-thread", JSON.stringify({ type: "userMessage", content: [{ type: "text", text: "继续项目" }] }), "userMessage", 1787627933000);
  db.prepare("insert into thread_items values (?, ?, ?, ?)").run("desktop-thread", JSON.stringify({ type: "agentMessage", content: [{ type: "text", text: "开始处理" }] }), "agentMessage", 1787627934000);
  db.close();
  await fs.mkdir(path.join(home, "sqlite"), { recursive: true });
  const catalog = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"));
  catalog.exec("create table local_thread_catalog (thread_id text primary key, display_title text, cwd text, model_provider text, source_updated_at real, source_kind text, missing_candidate integer)");
  catalog.prepare("insert into local_thread_catalog values (?, ?, ?, ?, ?, ?, ?)").run("desktop-thread", "桌面项目", "C:\\project", "openai", 1787627934, "vscode", 0);
  catalog.close();
  const libraryFile = path.join(home, "library.json");
  await syncConversations({ codexHome: home, libraryFile });
  const library = await readLibrary(libraryFile);
  assert.deepEqual(library.threads[0].messages.map((message) => message.content), ["继续项目", "开始处理"]);
  const detail = await readThreadDetail(library.threads[0], home);
  assert.equal(detail.messages.length, 2);
});

test("modern root state is authoritative and legacy state cannot revive archived or stale projects", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-authoritative-root-"));
  const { DatabaseSync } = await import("node:sqlite");
  const root = new DatabaseSync(path.join(home, "state_5.sqlite"));
  root.exec("create table threads (id text primary key, title text, cwd text, model_provider text, rollout_path text, updated_at_ms integer, archived integer, has_user_event integer, thread_source text)");
  const insertRoot = root.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertRoot.run("active-root", "Active root", "C:\\active", "openai", null, 1780000000000, 0, 1, "user");
  insertRoot.run("archived-root", "Archived root", "C:\\old", "openai", null, 1770000000000, 1, 1, "user");
  root.close();

  await fs.mkdir(path.join(home, "sqlite"), { recursive: true });
  const legacy = new DatabaseSync(path.join(home, "sqlite", "state_5.sqlite"));
  legacy.exec("create table threads (id text primary key, title text, cwd text, model_provider text, rollout_path text, updated_at_ms integer, archived integer, has_user_event integer, thread_source text)");
  const insertLegacy = legacy.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertLegacy.run("archived-root", "Stale archive copy", "C:\\old", "openai", null, 1770000000000, 0, 1, "user");
  insertLegacy.run("legacy-only", "Stale legacy project", "C:\\old", "openai", null, 1760000000000, 0, 1, "user");
  legacy.close();

  const catalog = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"));
  catalog.exec("create table local_thread_catalog (thread_id text primary key, display_title text, cwd text, model_provider text, source_updated_at real, source_kind text, missing_candidate integer)");
  const insertCatalog = catalog.prepare("insert into local_thread_catalog values (?, ?, ?, ?, ?, ?, ?)");
  insertCatalog.run("desktop-current", "Current desktop chat", "C:\\current", "openai", 1787627934, "vscode", 0);
  insertCatalog.run("archived-root", "Archived desktop projection", "C:\\old", "openai", 1787627933, "vscode", 0);
  insertCatalog.run("catalog-without-history", "Stale catalog row", "C:\\old", "openai", 1787627932, "vscode", 0);
  catalog.close();

  const history = new DatabaseSync(path.join(home, "thread_history_1.sqlite"));
  history.exec("create table thread_items (thread_id text, item_json text, item_type text, created_at_ms integer)");
  history.prepare("insert into thread_items values (?, ?, ?, ?)").run("desktop-current", JSON.stringify({ type: "userMessage", content: "keep me" }), "userMessage", 1787627934000);
  history.prepare("insert into thread_items values (?, ?, ?, ?)").run("archived-root", JSON.stringify({ type: "userMessage", content: "do not revive" }), "userMessage", 1787627933000);
  history.close();

  const libraryFile = path.join(home, "library.json");
  const result = await syncConversations({ codexHome: home, libraryFile });
  const library = await readLibrary(libraryFile);
  assert.equal(result.threads, 2);
  assert.deepEqual(new Set(library.threads.map((thread) => thread.id)), new Set(["active-root", "desktop-current"]));
  assert.equal(library.threads.some((thread) => thread.id === "archived-root"), false);
  assert.equal(library.threads.some((thread) => thread.id === "legacy-only"), false);
  assert.equal(library.threads.some((thread) => thread.id === "catalog-without-history"), false);
});
