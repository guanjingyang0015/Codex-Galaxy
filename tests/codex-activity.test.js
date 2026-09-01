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
