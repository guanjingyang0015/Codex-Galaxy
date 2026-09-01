import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { cleanupInvalidProjects, previewInvalidProjects } from "../project-cleanup.js";

const unzip = promisify(gunzip);

test("project cleanup removes only archived or explicitly missing tasks and keeps active projects", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-project-cleanup-"));
  const galaxy = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-project-library-"));
  const libraryFile = path.join(galaxy, "conversation-library.json");
  const archivedFile = path.join(home, "archived_sessions", "2026", "08", "archived.jsonl");
  const activeFile = path.join(home, "sessions", "active.jsonl");
  await fs.mkdir(path.dirname(archivedFile), { recursive: true });
  await fs.mkdir(path.dirname(activeFile), { recursive: true });
  const archivedContent = `${JSON.stringify({ type: "session_meta", payload: { id: "archived", cwd: "C:\\source-project" } })}\n`;
  await fs.writeFile(archivedFile, archivedContent);
  await fs.writeFile(activeFile, `${JSON.stringify({ type: "session_meta", payload: { id: "active" } })}\n`);
  await fs.writeFile(path.join(home, "session_index.jsonl"), [
    JSON.stringify({ id: "active", thread_name: "Active" }),
    JSON.stringify({ id: "archived", thread_name: "Archived" }),
    JSON.stringify({ id: "deleted", thread_name: "Deleted" }),
  ].join("\n") + "\n");
  await fs.writeFile(libraryFile, `${JSON.stringify({ version: 2, catalogVersion: 3, threads: [
    { id: "active", title: "Active" },
    { id: "archived", title: "Archived" },
    { id: "deleted", title: "Deleted" },
  ] })}\n`);

  const { DatabaseSync } = await import("node:sqlite");
  const root = new DatabaseSync(path.join(home, "state_5.sqlite"));
  root.exec("create table threads (id text primary key, rollout_path text, archived integer); create table thread_dynamic_tools (thread_id text, position integer); create table thread_spawn_edges (parent_thread_id text, child_thread_id text)");
  root.prepare("insert into threads values (?, ?, ?)").run("active", "sessions/active.jsonl", 0);
  root.prepare("insert into threads values (?, ?, ?)").run("archived", "archived_sessions/2026/08/archived.jsonl", 1);
  root.prepare("insert into thread_dynamic_tools values (?, ?)").run("archived", 1);
  root.prepare("insert into thread_spawn_edges values (?, ?)").run("active", "archived");
  root.close();

  await fs.mkdir(path.join(home, "sqlite"), { recursive: true });
  const desktop = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"));
  desktop.exec("create table local_thread_catalog (thread_id text primary key, source_kind text, missing_candidate integer); create table thread_timeline_ledger (thread_id text); create table automation_runs (thread_id text); create table inbox_items (thread_id text)");
  desktop.prepare("insert into local_thread_catalog values (?, ?, ?)").run("active", "vscode", 0);
  desktop.prepare("insert into local_thread_catalog values (?, ?, ?)").run("archived", "vscode", 0);
  desktop.prepare("insert into local_thread_catalog values (?, ?, ?)").run("deleted", "vscode", 1);
  desktop.prepare("insert into thread_timeline_ledger values (?)").run("archived");
  desktop.close();

  const history = new DatabaseSync(path.join(home, "thread_history_1.sqlite"));
  history.exec("create table thread_history_projection_state (thread_id text); create table thread_items (thread_id text); create table thread_turns (thread_id text)");
  history.prepare("insert into thread_items values (?)").run("active");
  history.prepare("insert into thread_items values (?)").run("archived");
  history.prepare("insert into thread_turns values (?)").run("deleted");
  history.close();

  const sourceDirectory = path.join(home, "source-project");
  await fs.mkdir(sourceDirectory);
  await fs.writeFile(path.join(sourceDirectory, "keep.txt"), "user source code");

  const preview = await previewInvalidProjects(home, libraryFile);
  assert.equal(preview.projects, 2);
  assert.equal(preview.archivedProjects, 1);
  assert.equal(preview.deletedProjects, 1);
  assert.equal(preview.files, 1);
  assert.ok(preview.databaseRows >= 7);

  const progress = [];
  const result = await cleanupInvalidProjects(home, libraryFile, { onProgress: (item) => progress.push(item) });
  assert.equal(result.projects, 2);
  assert.ok(result.backupDir);
  assert.equal(progress.at(-1).phase, "complete");
  assert.equal(await fs.stat(archivedFile).then(() => true).catch(() => false), false);
  assert.equal(await fs.readFile(activeFile, "utf8").then((text) => text.includes("active")), true);
  assert.equal(await fs.readFile(path.join(sourceDirectory, "keep.txt"), "utf8"), "user source code");

  const backupManifest = JSON.parse(await fs.readFile(path.join(result.backupDir, "manifest.json"), "utf8"));
  const archivedBackup = path.join(result.backupDir, backupManifest.archivedSessionBackups[0].backup);
  assert.equal((await unzip(await fs.readFile(archivedBackup))).toString("utf8"), archivedContent);
  assert.equal(await fs.stat(path.join(result.backupDir, "databases", "state_5.sqlite")).then(() => true), true);

  const verifyRoot = new DatabaseSync(path.join(home, "state_5.sqlite"), { readOnly: true });
  assert.deepEqual(verifyRoot.prepare("select id from threads order by id").all().map((row) => row.id), ["active"]);
  assert.equal(verifyRoot.prepare("select count(*) count from thread_dynamic_tools").get().count, 0);
  assert.equal(verifyRoot.prepare("select count(*) count from thread_spawn_edges").get().count, 0);
  verifyRoot.close();
  const verifyDesktop = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"), { readOnly: true });
  assert.deepEqual(verifyDesktop.prepare("select thread_id from local_thread_catalog").all().map((row) => row.thread_id), ["active"]);
  verifyDesktop.close();
  const verifyHistory = new DatabaseSync(path.join(home, "thread_history_1.sqlite"), { readOnly: true });
  assert.deepEqual(verifyHistory.prepare("select thread_id from thread_items").all().map((row) => row.thread_id), ["active"]);
  assert.equal(verifyHistory.prepare("select count(*) count from thread_turns").get().count, 0);
  verifyHistory.close();

  const index = await fs.readFile(path.join(home, "session_index.jsonl"), "utf8");
  assert.equal(index.includes("archived"), false);
  assert.equal(index.includes("deleted"), false);
  assert.equal(index.includes("active"), true);
  const library = JSON.parse(await fs.readFile(libraryFile, "utf8"));
  assert.deepEqual(library.threads.map((thread) => thread.id), ["active"]);
  assert.equal(library.catalogVersion, 5);
});

test("project cleanup is a no-op when there are no archived or deleted projects", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-project-cleanup-empty-"));
  const libraryFile = path.join(home, "library.json");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, rollout_path text, archived integer)");
  db.prepare("insert into threads values (?, ?, ?)").run("active", "sessions/active.jsonl", 0);
  db.close();
  await fs.writeFile(libraryFile, `${JSON.stringify({ version: 2, threads: [{ id: "active" }] })}\n`);
  const preview = await previewInvalidProjects(home, libraryFile);
  assert.equal(preview.projects, 0);
  const result = await cleanupInvalidProjects(home, libraryFile);
  assert.equal(result.projects, 0);
  assert.equal(result.backupDir, null);
});

test("project cleanup preserves an archived source rollout referenced by a live fork", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-project-cleanup-lineage-"));
  const galaxy = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-project-library-lineage-"));
  const libraryFile = path.join(galaxy, "library.json");
  const sourceFile = path.join(home, "archived_sessions", "source.jsonl");
  const forkFile = path.join(home, "sessions", "fork.jsonl");
  await fs.mkdir(path.dirname(sourceFile), { recursive: true });
  await fs.mkdir(path.dirname(forkFile), { recursive: true });
  await fs.writeFile(sourceFile, `${JSON.stringify({ type: "session_meta", payload: { id: "source" } })}\n`);
  await fs.writeFile(forkFile, `${JSON.stringify({ type: "session_meta", payload: { id: "fork", forked_from_id: "source", history_base: { thread_id: "source" } } })}\n`);
  await fs.writeFile(path.join(home, "session_index.jsonl"), `${JSON.stringify({ id: "fork" })}\n${JSON.stringify({ id: "source" })}\n`);

  const { DatabaseSync } = await import("node:sqlite");
  const root = new DatabaseSync(path.join(home, "state_5.sqlite"));
  root.exec("create table threads (id text primary key, rollout_path text, archived integer)");
  root.prepare("insert into threads values (?, ?, ?)").run("fork", "sessions/fork.jsonl", 0);
  root.prepare("insert into threads values (?, ?, ?)").run("source", "archived_sessions/source.jsonl", 1);
  root.close();
  await fs.writeFile(libraryFile, JSON.stringify({ version: 2, threads: [{ id: "fork" }, { id: "source" }] }));

  const preview = await previewInvalidProjects(home, libraryFile);
  assert.equal(preview.projects, 0);
  assert.equal(preview.lineageProtectedProjects, 1);
  const result = await cleanupInvalidProjects(home, libraryFile);
  assert.equal(result.backupDir, null);
  assert.equal(await fs.readFile(sourceFile, "utf8").then(Boolean), true);
});
