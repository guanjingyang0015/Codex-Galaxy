import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasActiveCodexTurn, latestCodexThreadId } from "../codex-activity.js";

test("active Codex turns block account switching while completed turns do not", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-activity-"));
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(home, "thread_history_1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("create table thread_turns (thread_id text, status text, completed_at text, started_at integer)");
  const now = Math.floor(Date.now() / 1000);
  db.prepare("insert into thread_turns values (?, ?, ?, ?)").run("active", "inProgress", null, now);
  db.prepare("insert into thread_turns values (?, ?, ?, ?)").run("done", "completed", "2026-09-01T10:00:00Z", now - 60);
  db.close();
  assert.equal(await hasActiveCodexTurn(home), true);

  const done = new DatabaseSync(file);
  done.prepare("update thread_turns set status = ?, completed_at = ? where thread_id = ?").run("completed", "2026-09-01T10:01:00Z", "active");
  done.close();
  assert.equal(await hasActiveCodexTurn(home), false);
});

test("stale unfinished turns from a crashed Codex session do not block switching", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-activity-stale-"));
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(home, "thread_history_1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("create table thread_turns (thread_id text, status text, completed_at text, started_at integer)");
  db.prepare("insert into thread_turns values (?, ?, ?, ?)").run(
    "stale",
    "inProgress",
    null,
    Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000),
  );
  db.close();
  assert.equal(await hasActiveCodexTurn(home), false);
});

test("an unfinished marker is ignored when a later terminal turn exists in the same thread", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-activity-later-terminal-"));
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(home, "thread_history_1.sqlite");
  const db = new DatabaseSync(file);
  db.exec("create table thread_turns (thread_id text, rollout_ordinal integer, status text, completed_at text, started_at integer)");
  const now = Math.floor(Date.now() / 1000);
  db.prepare("insert into thread_turns values (?, ?, ?, ?, ?)").run("same-thread", 10, "inProgress", null, now - 60);
  db.prepare("insert into thread_turns values (?, ?, ?, ?, ?)").run("same-thread", 11, "completed", now, now - 30);
  db.close();
  assert.equal(await hasActiveCodexTurn(home), false);
});

test("Codex activity returns unknown when no readable turn database exists", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-activity-empty-"));
  assert.equal(await hasActiveCodexTurn(home), null);
});

test("latest Codex thread prefers an active user turn and excludes automation", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-latest-thread-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, updated_at_ms integer, archived integer, thread_source text)");
  db.prepare("insert into threads values (?, ?, ?, ?)").run("old-user", 100, 0, "user");
  db.prepare("insert into threads values (?, ?, ?, ?)").run("new-automation", 200, 0, "automation");
  db.exec("create table thread_turns (thread_id text, status text, completed_at text, started_at integer)");
  db.prepare("insert into thread_turns values (?, ?, ?, ?)").run("old-user", "inProgress", null, Math.floor(Date.now() / 1000));
  db.close();
  assert.equal(await latestCodexThreadId(home), "old-user");
});

test("latest Codex thread ignores stale unfinished turns and falls back to the newest user thread", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-latest-stale-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  db.exec("create table threads (id text primary key, updated_at_ms integer, archived integer, thread_source text)");
  db.prepare("insert into threads values (?, ?, ?, ?)").run("stale-turn", 100, 0, "user");
  db.prepare("insert into threads values (?, ?, ?, ?)").run("latest-user", Date.now(), 0, "user");
  db.exec("create table thread_turns (thread_id text, status text, completed_at text, started_at integer)");
  db.prepare("insert into thread_turns values (?, ?, ?, ?)").run(
    "stale-turn",
    "inProgress",
    null,
    Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000),
  );
  db.close();
  assert.equal(await latestCodexThreadId(home), "latest-user");
});

test("activity details enumerate and deduplicate all tasks, including scheduled jobs", async () => {
  const { inspectCodexActivity } = await import('../codex-activity.js');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'galaxy-activity-details-'));
  const { DatabaseSync } = await import('node:sqlite');
  const now = Date.now();
  for (const name of ['thread_history.sqlite', 'thread_history_1.sqlite']) {
    const db = new DatabaseSync(path.join(home, name));
    db.exec('create table thread_turns (thread_id text, status text, started_at integer, completed_at integer)');
    for (const id of ['chat', 'cron', 'missing']) db.prepare('insert into thread_turns values (?, ?, ?, null)').run(id, 'inProgress', now);
    db.prepare('insert into thread_turns values (?, ?, ?, ?)').run('done', 'completed', now, now);
    db.close();
  }
  const meta = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  meta.exec('create table threads (id text, title text, cwd text, thread_source text)');
  meta.prepare('insert into threads values (?, ?, ?, ?)').run('chat', '修复项目', 'C:/project', 'user');
  meta.prepare('insert into threads values (?, ?, ?, ?)').run('cron', '每日巡检', 'C:/jobs', 'user');
  meta.close();
  await fs.mkdir(path.join(home, 'sqlite'));
  const automation = new DatabaseSync(path.join(home, 'sqlite/jobs.db'));
  automation.exec("create table automation_runs (thread_id text); insert into automation_runs values ('cron')");
  automation.close();
  const result = await inspectCodexActivity(home);
  assert.equal(result.active, true);
  assert.equal(result.tasks.length, 3);
  assert.equal(result.tasks.find(t => t.id === 'chat').title, '修复项目');
  assert.equal(result.tasks.find(t => t.id === 'cron').source, 'automation');
  assert.equal(result.tasks.find(t => t.id === 'missing').title, 'missing');
  assert.equal(result.tasks[0].lastActivityAt, now);
  await fs.writeFile(path.join(home, 'thread_history_2.sqlite'), 'unreadable');
  assert.equal((await inspectCodexActivity(home)).active, true);
  for (const name of ['thread_history.sqlite', 'thread_history_1.sqlite']) {
    const db = new DatabaseSync(path.join(home, name)); db.exec("update thread_turns set status='completed'"); db.close();
  }
  assert.equal((await inspectCodexActivity(home)).active, null);
});
