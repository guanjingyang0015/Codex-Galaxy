import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupCompletedAutomations, getAutomationSettings, previewCompletedAutomations, setAutomationSettings } from "../automation-cleanup.js";

test("automation cleanup only removes completed history after explicit enable and leaves configuration", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-automation-cleanup-"));
  const root = path.join(home, "automations", "done-task");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "automation.toml"), 'status = "COMPLETED"\n');
  await fs.writeFile(path.join(root, "memory.md"), "finished\n");
  const settings = path.join(home, "settings.json");
  assert.equal((await previewCompletedAutomations(home)).files.length, 1);
  assert.equal((await cleanupCompletedAutomations(home, settings)).skipped, true);
  await setAutomationSettings(settings, { autoCleanCompleted: true });
  const result = await cleanupCompletedAutomations(home, settings);
  assert.equal(result.files, 1);
  assert.equal(await fs.stat(path.join(root, "automation.toml")).then(() => true), true);
  assert.equal(await fs.stat(path.join(root, "memory.md")).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(path.join(result.backupDir, "automations", "done-task", "memory.md")).then(() => true), true);
  assert.deepEqual(await getAutomationSettings(settings), { autoCleanCompleted: true });
});

test("automation cleanup removes only finished automation_runs and keeps active runs", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-automation-runs-"));
  await fs.mkdir(path.join(home, "sqlite"), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"));
  db.exec("create table automation_runs (thread_id text, automation_id text, status text, archived_user_message text, archived_assistant_message text, inbox_summary text)");
  db.prepare("insert into automation_runs values (?, ?, ?, ?, ?, ?)").run("done", "a", "ARCHIVED", "u", "a", "summary");
  db.prepare("insert into automation_runs values (?, ?, ?, ?, ?, ?)").run("active", "a", "RUNNING", "u", "a", "summary");
  db.close();
  const settings = path.join(home, "settings.json");
  const preview = await previewCompletedAutomations(home);
  assert.equal(preview.rows, 1);
  await setAutomationSettings(settings, { autoCleanCompleted: true });
  const result = await cleanupCompletedAutomations(home, settings);
  assert.equal(result.rows, 1);
  const verify = new DatabaseSync(path.join(home, "sqlite", "codex-dev.db"), { readOnly: true });
  assert.equal(verify.prepare("select count(*) c from automation_runs where status='ARCHIVED'").get().c, 0);
  assert.equal(verify.prepare("select count(*) c from automation_runs where status='RUNNING'").get().c, 1);
  verify.close();
});
