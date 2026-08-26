import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recentThreadModels, restoreProviderMetadata, syncProviderMetadata, targetProviderForProfile } from "../provider-sync.js";

test("provider sync can preserve the continuation model while changing only the API route", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-sync-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const rootFile = path.join(sessions, "root.jsonl");
  const childFile = path.join(sessions, "child.jsonl");
  const userLine = JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "keep this exact history" }] } });
  const historicalModelLine = JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4", reasoning_effort: "medium" } });
  await fs.writeFile(rootFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", cwd: "C:\\project", model_provider: "openai" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "continue" } }),
    historicalModelLine,
    userLine,
  ].join("\n") + "\n");
  await fs.writeFile(childFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "child-thread", source: { subagent: "worker" }, model_provider: "openai" } }),
    userLine,
  ].join("\n") + "\n");

  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(home, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text, has_user_event integer)");
  db.exec("create table local_thread_catalog (thread_id text primary key, model_provider text)");
  db.prepare("insert into threads values (?, ?, ?, ?)").run("root-thread", "openai", "gpt-5.4", 0);
  db.prepare("insert into threads values (?, ?, ?, ?)").run("child-thread", "openai", "gpt-5.4", 0);
  db.prepare("insert into local_thread_catalog values (?, ?)").run("root-thread", "openai");
  db.close();

  const progress = [];
  const result = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "relay-any-vendor",
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.changedSessionFiles, 1);
  assert.equal(result.sqliteRowsUpdated, 3);
  assert.equal(result.modelRowsUpdated, 0);
  assert.ok(result.backupDir.startsWith(path.join(home, "backups_state")));
  assert.deepEqual(progress.at(0), { phase: "scan", completed: 0, total: 2, processedBytes: 0, totalBytes: 0 });
  assert.equal(progress.at(-1).phase, "complete");
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);

  const rootLines = (await fs.readFile(rootFile, "utf8")).trim().split("\n").map(JSON.parse);
  const childLines = (await fs.readFile(childFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rootLines[0].payload.model_provider, "relay-any-vendor");
  assert.equal(rootLines[2].payload.model, "gpt-5.4");
  assert.equal(rootLines[3].payload.content[0].text, "keep this exact history");
  assert.equal(childLines[0].payload.model_provider, "openai");

  const verify = new DatabaseSync(databasePath, { readOnly: true });
  const rootRow = verify.prepare("select model_provider, model, has_user_event from threads where id = ?").get("root-thread");
  assert.equal(rootRow.model_provider, "relay-any-vendor");
  assert.equal(rootRow.model, "gpt-5.4");
  assert.equal(rootRow.has_user_event, 1);
  assert.equal(verify.prepare("select model_provider from threads where id = ?").get("child-thread").model_provider, "openai");
  assert.equal(verify.prepare("select model from threads where id = ?").get("child-thread").model, "gpt-5.4");
  verify.close();
});

test("official provider sync can explicitly restore the official continuation model", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-official-sync-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "root.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { id: "root-thread", cwd: "C:\\project", model_provider: "relay-b" } })}\n`);
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(home, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text)");
  db.prepare("insert into threads values (?, ?, ?)").run("root-thread", "relay-b", "relay-only-model");
  db.close();

  const result = await syncProviderMetadata({ codexHome: home, targetProvider: "openai", targetModel: "gpt-5.6-sol" });
  const verify = new DatabaseSync(databasePath, { readOnly: true });
  const restored = verify.prepare("select model_provider, model from threads where id = ?").get("root-thread");
  assert.equal(restored.model_provider, "openai");
  assert.equal(restored.model, "gpt-5.6-sol");
  verify.close();
  assert.equal(result.modelRowsUpdated, 1);
});

test("official sync removes incompatible message and function-call IDs and can restore the exact rollout", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-official-message-id-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  const invalidId = "chatcmpl-202608251102513098513998268d9d6GUHxOt7g_msg_0";
  const invalidMessage = {
    type: "response_item",
    payload: {
      type: "message",
      id: invalidId,
      role: "assistant",
      content: [{ type: "output_text", text: "keep this exact history" }],
      internal_chat_message_metadata_passthrough: { source: "relay" },
    },
  };
  const validMessage = {
    type: "response_item",
    payload: {
      type: "message",
      id: "msg_official_123",
      role: "assistant",
      content: [{ type: "output_text", text: "keep the official id" }],
    },
  };
  const toolCall = {
    type: "response_item",
    payload: {
      type: "function_call",
      id: "call_tool_item",
      call_id: "call_keep_me",
      name: "example",
      arguments: "{}",
      metadata: { source: "relay" },
    },
  };
  const validToolCall = {
    type: "response_item",
    payload: {
      type: "function_call",
      id: "fc_official_tool_item",
      call_id: "call_official",
      name: "example",
      arguments: "{}",
    },
  };
  const olderHistory = {
    type: "event_msg",
    payload: { type: "assistant_message", message: "x".repeat(256 * 1024) },
  };
  const original = [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "relay-b" } }),
    JSON.stringify(olderHistory),
    JSON.stringify(invalidMessage),
    JSON.stringify(validMessage),
    JSON.stringify(toolCall),
    JSON.stringify(validToolCall),
  ].join("\n") + "\n";
  await fs.writeFile(file, original);

  const result = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(lines[0].payload.model_provider, "openai");
  assert.deepEqual(lines[1], olderHistory);
  assert.equal(Object.hasOwn(lines[2].payload, "id"), false);
  assert.deepEqual(lines[2].payload.content, invalidMessage.payload.content);
  assert.equal(lines[2].payload.role, invalidMessage.payload.role);
  assert.deepEqual(lines[2].payload.internal_chat_message_metadata_passthrough, invalidMessage.payload.internal_chat_message_metadata_passthrough);
  assert.deepEqual(lines[3], validMessage);
  assert.equal(Object.hasOwn(lines[4].payload, "id"), false);
  assert.equal(lines[4].payload.call_id, toolCall.payload.call_id);
  assert.equal(lines[4].payload.name, toolCall.payload.name);
  assert.equal(lines[4].payload.arguments, toolCall.payload.arguments);
  assert.deepEqual(lines[4].payload.metadata, toolCall.payload.metadata);
  assert.deepEqual(lines[5], validToolCall);
  assert.equal(result.sanitizedMessageIds, 2);

  await restoreProviderMetadata({ codexHome: home, backupDir: result.backupDir });
  assert.equal(await fs.readFile(file, "utf8"), original);
});

test("API-to-API provider sync does not remove relay response message IDs", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-api-message-id-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  const invalidId = "chatcmpl-20260825111012453431286_msg_0";
  await fs.writeFile(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "relay-a" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: invalidId, role: "assistant", content: [] } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", id: "call_relay_item", call_id: "call_relay", name: "example", arguments: "{}" } }),
  ].join("\n") + "\n");

  const result = await syncProviderMetadata({ codexHome: home, targetProvider: "relay-b" });
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(lines[0].payload.model_provider, "relay-b");
  assert.equal(lines[1].payload.id, invalidId);
  assert.equal(lines[2].payload.id, "call_relay_item");
  assert.equal(result.sanitizedMessageIds, 0);
});

test("official message ID scan cache skips unchanged histories and invalidates safely after rollback", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-official-cache-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "msg_official", role: "assistant", content: "x".repeat(1024 * 1024) } }),
  ].join("\n") + "\n");

  const first = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.ok(first.scannedOfficialSessionBytes > 1024 * 1024);
  assert.equal(first.cachedOfficialSessionFiles, 1);

  const second = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.equal(second.scannedOfficialSessionBytes, 0);
  assert.equal(second.cachedOfficialSessionFiles, 1);

  const invalidId = "chatcmpl-cache-invalidation_msg_0";
  await fs.appendFile(file, `${JSON.stringify({
    type: "response_item",
    payload: { type: "message", id: invalidId, role: "assistant", content: [] },
  })}\n`);
  const originalWithInvalidId = await fs.readFile(file, "utf8");
  const third = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.ok(third.scannedOfficialSessionBytes > 1024 * 1024);
  assert.equal(third.sanitizedMessageIds, 1);

  await restoreProviderMetadata({ codexHome: home, backupDir: third.backupDir });
  assert.equal(await fs.readFile(file, "utf8"), originalWithInvalidId);

  const fourth = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.ok(fourth.scannedOfficialSessionBytes > 1024 * 1024);
  assert.equal(fourth.sanitizedMessageIds, 1);
});

test("provider header switches preserve the official compatibility cache", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-cache-switch-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "msg_official", role: "assistant", content: [] } }),
  ].join("\n") + "\n");

  await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  await syncProviderMetadata({ codexHome: home, targetProvider: "relay-b" });
  const backToOfficial = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.equal(backToOfficial.scannedOfficialSessionBytes, 0);
  assert.equal(backToOfficial.officialScanTotalBytes, 0);
});

test("provider header switches do not preserve a cache stamp after body changes", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-cache-body-change-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "msg_official", role: "assistant", content: [] } }),
  ].join("\n") + "\n");

  await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  await fs.appendFile(file, `${JSON.stringify({
    type: "response_item",
    payload: { type: "message", id: "msg_new", role: "assistant", content: [] },
  })}\n`);
  await syncProviderMetadata({ codexHome: home, targetProvider: "relay-b" });
  const backToOfficial = await syncProviderMetadata({ codexHome: home, targetProvider: "openai" });
  assert.ok(backToOfficial.scannedOfficialSessionBytes > 0);
  assert.ok(backToOfficial.officialScanTotalBytes > 0);
});

test("official compatibility progress counts only uncached rollout bytes", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-official-progress-cache-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const largeFile = path.join(sessions, "large.jsonl");
  const changingFile = path.join(sessions, "changing.jsonl");
  await fs.writeFile(largeFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "large", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "msg_large", role: "assistant", content: "x".repeat(3 * 1024 * 1024) } }),
  ].join("\n") + "\n");
  await fs.writeFile(changingFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "changing", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: "msg_changing", role: "assistant", content: "ready" } }),
  ].join("\n") + "\n");

  const firstProgress = [];
  const first = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "openai",
    onProgress: (entry) => firstProgress.push(entry),
  });
  assert.equal(first.officialScanFiles, 2);
  assert.equal(first.cachedOfficialSessionFiles, 2);
  assert.ok(first.cachedOfficialSessionBytes >= 3 * 1024 * 1024);
  assert.equal(firstProgress[0].scanFiles, 2);
  assert.equal(firstProgress[0].cachedFiles, 0);

  const invalidId = "chatcmpl-progress-cache_msg_0";
  await fs.appendFile(changingFile, `${JSON.stringify({
    type: "response_item",
    payload: { type: "message", id: invalidId, role: "assistant", content: [] },
  })}\n`);
  const changingSize = (await fs.stat(changingFile)).size;
  const secondProgress = [];
  const second = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "openai",
    onProgress: (entry) => secondProgress.push(entry),
  });
  assert.equal(second.officialScanFiles, 1);
  assert.equal(second.officialScanTotalBytes, changingSize);
  assert.equal(second.scannedOfficialSessionBytes, changingSize);
  assert.ok(second.cachedOfficialSessionBytes >= 3 * 1024 * 1024);
  assert.equal(secondProgress[0].scanFiles, 1);
  assert.equal(secondProgress[0].cachedFiles, 1);
  assert.equal(secondProgress[0].totalBytes, changingSize);
  assert.ok(secondProgress[0].totalBytes < 1024 * 1024);
});

test("official continuation can scan only the thread being opened", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-targeted-official-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const targetFile = path.join(sessions, "target.jsonl");
  const otherFile = path.join(sessions, "other.jsonl");
  const invalidTarget = "chatcmpl-targeted_msg_0";
  const invalidOther = "chatcmpl-other_msg_0";
  const makeHistory = (id, invalidId) => [
    JSON.stringify({ type: "session_meta", payload: { id, model_provider: "relay-a" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: invalidId, role: "assistant", content: [] } }),
  ].join("\n") + "\n";
  await fs.writeFile(targetFile, makeHistory("target-thread", invalidTarget));
  await fs.writeFile(otherFile, makeHistory("other-thread", invalidOther));

  const result = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "openai",
    messageIdScanThreadId: "target-thread",
  });
  const target = (await fs.readFile(targetFile, "utf8")).trim().split("\n").map(JSON.parse);
  const other = (await fs.readFile(otherFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(result.officialScanFiles, 1);
  assert.equal(result.sanitizedMessageIds, 1);
  assert.equal(Object.hasOwn(target[1].payload, "id"), false);
  assert.equal(other[1].payload.id, invalidOther);
});

test("official continuation falls back to a full scan when its thread id is stale", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-targeted-stale-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const makeHistory = (id) => [
    JSON.stringify({ type: "session_meta", payload: { id, model_provider: "relay-a" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", id: `chatcmpl-${id}_msg_0`, role: "assistant", content: [] } }),
  ].join("\n") + "\n";
  const first = path.join(sessions, "first.jsonl");
  const second = path.join(sessions, "second.jsonl");
  await fs.writeFile(first, makeHistory("first-thread"));
  await fs.writeFile(second, makeHistory("second-thread"));

  const result = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "openai",
    messageIdScanThreadId: "missing-thread",
  });
  assert.equal(result.officialScanFiles, 2);
  assert.equal(result.sanitizedMessageIds, 2);
  for (const file of [first, second]) {
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(Object.hasOwn(lines[1].payload, "id"), false);
  }
});

test("provider restore remains compatible with version 2 session metadata backups", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-v2-backup-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  const originalLine = JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "relay-b" } });
  const currentLine = JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "openai" } });
  await fs.writeFile(file, `${currentLine}\n`);
  const backupDir = path.join(home, "backups_state", "codex-galaxy-provider-sync", "legacy-v2");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, "session-meta-backup.json"), `${JSON.stringify([{
    path: file,
    originalSessionMetaLines: [originalLine],
    originalSessionMetaEntries: [{ lineNumber: 0, line: originalLine }],
  }], null, 2)}\n`);
  await fs.writeFile(path.join(backupDir, "metadata.json"), `${JSON.stringify({
    version: 2,
    namespace: "codex-galaxy-provider-sync",
    targetProvider: "openai",
    targetModel: null,
    databaseFiles: [],
  }, null, 2)}\n`);

  await restoreProviderMetadata({ codexHome: home, backupDir });
  assert.equal(await fs.readFile(file, "utf8"), `${originalLine}\n`);
});

test("API sync repairs a model value written by an older Galaxy release", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-repair-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "root.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "root-thread", model_provider: "relay-b" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" } }),
  ].join("\n") + "\n");
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(home, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text)");
  db.prepare("insert into threads values (?, ?, ?)").run("root-thread", "relay-b", "gpt-5.6");
  db.close();

  const result = await syncProviderMetadata({ codexHome: home, targetProvider: "relay-b", targetModel: null });
  const verify = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(verify.prepare("select model from threads where id = ?").get("root-thread").model, "gpt-5.4");
  verify.close();
  assert.equal(result.modelRowsUpdated, 1);
});

test("profile provider selection is vendor agnostic", () => {
  assert.equal(targetProviderForProfile({ kind: "official", id: "a" }), "openai");
  assert.equal(targetProviderForProfile({ kind: "api", id: "b", providerKey: "deepseek-relay" }), "deepseek-relay");
});

test("recent models are scoped to the target provider", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-recent-models-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "official.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "official", model_provider: "openai" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-terra" } }),
  ].join("\n") + "\n");
  await fs.writeFile(path.join(sessions, "relay.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "relay", model_provider: "relay-b" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
  ].join("\n") + "\n");

  assert.deepEqual(await recentThreadModels(home, "relay-b"), ["gpt-5.6-sol"]);
  assert.deepEqual(await recentThreadModels(home, "openai"), ["gpt-5.6-terra"]);
});

test("provider sync ignores archived rollouts and reports byte progress without retaining whole histories", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-active-only-"));
  const sessions = path.join(home, "sessions");
  const archivedSessions = path.join(home, "archived_sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.mkdir(archivedSessions, { recursive: true });
  const activeFile = path.join(sessions, "active.jsonl");
  const archivedFile = path.join(archivedSessions, "archived.jsonl");
  const largeHistory = "x".repeat(2 * 1024 * 1024);
  await fs.writeFile(activeFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "active", model_provider: "openai" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: largeHistory } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
  ].join("\n") + "\n");
  await fs.writeFile(archivedFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "archived", model_provider: "openai" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" } }),
  ].join("\n") + "\n");

  const progress = [];
  const result = await syncProviderMetadata({
    codexHome: home,
    targetProvider: "relay-b",
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.changedSessionFiles, 1);
  assert.ok(result.processedBytes > 2 * 1024 * 1024);
  assert.equal(progress[0].total, 1);
  assert.ok(progress.some((entry) => entry.phase === "rewrite" && entry.totalBytes > 2 * 1024 * 1024));
  assert.equal(JSON.parse((await fs.readFile(activeFile, "utf8")).split("\n")[0]).payload.model_provider, "relay-b");
  assert.equal(JSON.parse((await fs.readFile(archivedFile, "utf8")).split("\n")[0]).payload.model_provider, "openai");
});

test("a recent lock from a dead process is reclaimed while a live owner remains protected", async () => {
  const staleHome = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-stale-lock-"));
  const staleLock = path.join(staleHome, "tmp", "codex-galaxy-provider-sync.lock");
  await fs.mkdir(staleLock, { recursive: true });
  await fs.writeFile(path.join(staleLock, "owner.json"), `${JSON.stringify({ pid: 2147483647 })}\n`);
  const recovered = await syncProviderMetadata({ codexHome: staleHome, targetProvider: "openai" });
  assert.equal(recovered.changedSessionFiles, 0);
  assert.equal(await fs.stat(staleLock).then(() => true).catch(() => false), false);

  const liveHome = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-live-lock-"));
  const liveLock = path.join(liveHome, "tmp", "codex-galaxy-provider-sync.lock");
  await fs.mkdir(liveLock, { recursive: true });
  await fs.writeFile(path.join(liveLock, "owner.json"), `${JSON.stringify({ pid: process.pid })}\n`);
  await assert.rejects(
    syncProviderMetadata({ codexHome: liveHome, targetProvider: "openai" }),
    /另一个 Codex Galaxy 实例正在同步/,
  );
  await fs.rm(liveLock, { recursive: true, force: true });
});

test("provider metadata changes patch the session header in place when it fits", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-provider-in-place-"));
  const sessions = path.join(home, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, "root.jsonl");
  const history = "x".repeat(1024 * 1024);
  await fs.writeFile(file, [
    JSON.stringify({ type: "session_meta", payload: { id: "root", model_provider: "relay-old" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: history } }),
  ].join("\n") + "\n");
  const before = await fs.stat(file);
  const result = await syncProviderMetadata({ codexHome: home, targetProvider: "x" });
  const after = await fs.stat(file);
  assert.equal(result.changedSessionFiles, 1);
  assert.equal(result.processedBytes, 0);
  assert.equal(after.size, before.size);
  assert.equal(JSON.parse((await fs.readFile(file, "utf8")).split("\n")[0]).payload.model_provider, "x");
});
