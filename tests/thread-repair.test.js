import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseThreadRollout, repairThreadRollout } from "../thread-repair.js";

async function fixture(id = "thread-1") {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-thread-repair-"));
  const directory = path.join(codexHome, "sessions", "2026", "08", "26");
  await fs.mkdir(directory, { recursive: true });
  const source = path.join(directory, `rollout-${id}.jsonl`);
  return { codexHome, source, thread: { id, source } };
}

function metadata(id = "thread-1") {
  return JSON.stringify({ type: "session_meta", payload: { id, cwd: "C:\\project", model_provider: "openai" } });
}

async function readRepairBackup(result) {
  return fs.readFile(result.backupFile);
}

test("a rollout that starts with matching session metadata is healthy", async () => {
  const item = await fixture();
  await fs.writeFile(item.source, `${metadata()}\n${JSON.stringify({ type: "event_msg", payload: { type: "user_message" } })}\n`);
  assert.deepEqual(await diagnoseThreadRollout(item), {
    status: "healthy",
    issue: null,
    repairSource: null,
    firstRecordType: "session_meta",
    firstRecordLine: 1,
    fileSize: (await fs.stat(item.source)).size,
  });
});

test("UTF-8 BOM is removed only after a byte-exact backup is created", async () => {
  const item = await fixture();
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${metadata()}\r\n{"type":"event_msg"}\r\n`)]);
  await fs.writeFile(item.source, original);
  const diagnosis = await diagnoseThreadRollout(item);
  assert.equal(diagnosis.issue, "utf8-bom");
  assert.equal(diagnosis.status, "repairable");

  const repaired = await repairThreadRollout(item);
  assert.deepEqual(await readRepairBackup(repaired), original);
  assert.deepEqual(await fs.readFile(item.source), original.subarray(3));
  assert.equal(repaired.diagnosis.status, "healthy");
});

test("leading blank lines are trimmed without changing the remaining rollout bytes", async () => {
  const item = await fixture();
  const body = Buffer.from(`${metadata()}\n{"type":"response_item","payload":{"type":"message","content":"keep"}}\n`);
  const original = Buffer.concat([Buffer.from("\r\n\n"), body]);
  await fs.writeFile(item.source, original);
  assert.equal((await diagnoseThreadRollout(item)).issue, "leading-blank-lines");
  const repaired = await repairThreadRollout(item);
  assert.deepEqual(await readRepairBackup(repaired), original);
  assert.deepEqual(await fs.readFile(item.source), body);
});

test("real metadata found on a later line is moved to the first line", async () => {
  const item = await fixture();
  const before = `${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "first" } })}\r\n`;
  const meta = metadata();
  const after = `{"type":"response_item","payload":{"type":"message","content":"after"}}\n`;
  await fs.writeFile(item.source, `${before}${meta}\r\n${after}`);
  const diagnosis = await diagnoseThreadRollout(item);
  assert.equal(diagnosis.issue, "metadata-later");
  assert.equal(diagnosis.repairSource, "rollout");

  await repairThreadRollout(item);
  assert.equal(await fs.readFile(item.source, "utf8"), `${meta}\r\n${before}${after}`);
});

test("later metadata without a trailing newline remains valid after moving", async () => {
  const item = await fixture();
  await fs.writeFile(item.source, `{"type":"event_msg"}\n${metadata()}`);
  await repairThreadRollout(item);
  assert.equal(await fs.readFile(item.source, "utf8"), `${metadata()}\n{"type":"event_msg"}\n`);
});

test("missing metadata can be restored only from a matching trusted Galaxy provider backup", async () => {
  const item = await fixture();
  const original = Buffer.from('{"type":"event_msg","payload":{"type":"user_message","message":"keep"}}\n');
  await fs.writeFile(item.source, original);
  const providerBackup = path.join(item.codexHome, "backups_state", "codex-galaxy-provider-sync", "trusted");
  await fs.mkdir(providerBackup, { recursive: true });
  await fs.writeFile(path.join(providerBackup, "metadata.json"), `${JSON.stringify({
    version: 3,
    namespace: "codex-galaxy-provider-sync",
  })}\n`);
  await fs.writeFile(path.join(providerBackup, "session-meta-backup.json"), `${JSON.stringify([{
    path: item.source,
    lineBackups: [{ lineNumber: 0, originalLine: metadata(), nextLine: metadata() }],
  }])}\n`);

  const diagnosis = await diagnoseThreadRollout(item);
  assert.equal(diagnosis.status, "repairable");
  assert.equal(diagnosis.repairSource, "galaxy-backup");
  const repaired = await repairThreadRollout(item);
  assert.deepEqual(await readRepairBackup(repaired), original);
  assert.equal(await fs.readFile(item.source, "utf8"), `${metadata()}\n${original.toString("utf8")}`);
});

test("a session metadata thread id mismatch is blocked", async () => {
  const item = await fixture();
  await fs.writeFile(item.source, `${metadata("different-thread")}\n`);
  const diagnosis = await diagnoseThreadRollout(item);
  assert.equal(diagnosis.status, "blocked");
  assert.equal(diagnosis.issue, "thread-mismatch");
  await assert.rejects(repairThreadRollout(item), /无法自动安全修复/);
});

test("missing metadata without a trusted backup is blocked", async () => {
  const item = await fixture();
  await fs.writeFile(item.source, '{"type":"event_msg"}\n');
  const fakeBackup = path.join(item.codexHome, "backups_state", "codex-galaxy-provider-sync", "untrusted");
  await fs.mkdir(fakeBackup, { recursive: true });
  await fs.writeFile(path.join(fakeBackup, "session-meta-backup.json"), JSON.stringify([{
    path: item.source,
    originalSessionMetaLines: [metadata()],
  }]));
  const diagnosis = await diagnoseThreadRollout(item);
  assert.equal(diagnosis.status, "blocked");
  assert.equal(diagnosis.issue, "missing-metadata");
});

test("repair refuses to replace a rollout that changes during the operation", async () => {
  const item = await fixture();
  const original = Buffer.from(`\n${metadata()}\n{"type":"event_msg"}\n`);
  await fs.writeFile(item.source, original);
  await assert.rejects(repairThreadRollout({
    ...item,
    onProgress: async ({ phase }) => {
      if (phase === "verify") await fs.appendFile(item.source, '{"type":"event_msg","payload":{"changed":true}}\n');
    },
  }), /修复期间发生了变化/);
  assert.match(await fs.readFile(item.source, "utf8"), /"changed":true/);
});

test("repair aborts before replacement when a Codex writer appears at commit time", async () => {
  const item = await fixture();
  const original = Buffer.from(`\n${metadata()}\n{"type":"event_msg"}\n`);
  await fs.writeFile(item.source, original);
  await assert.rejects(repairThreadRollout({
    ...item,
    onBeforeCommit: async () => {
      throw new Error("Codex writer started");
    },
  }), /Codex writer started/);
  assert.deepEqual(await fs.readFile(item.source), original);
});

test("large rollouts are repaired with chunked copying and preserve the full tail", async () => {
  const item = await fixture();
  const tailChunk = Buffer.from(`${JSON.stringify({ type: "response_item", payload: { type: "message", content: "x".repeat(4096) } })}\n`);
  const chunks = [Buffer.from(`\n${metadata()}\n`)];
  for (let index = 0; index < 4096; index += 1) chunks.push(tailChunk);
  const original = Buffer.concat(chunks);
  await fs.writeFile(item.source, original);

  const repaired = await repairThreadRollout(item);
  const next = await fs.readFile(item.source);
  assert.equal(next.length, original.length - 1);
  assert.deepEqual(next.subarray(0, Buffer.byteLength(metadata()) + 1), Buffer.from(`${metadata()}\n`));
  assert.deepEqual(next.subarray(-tailChunk.length), tailChunk);
  assert.deepEqual(await readRepairBackup(repaired), original);
});

test("a repair remains successful when the post-replacement audit record cannot be committed", async () => {
  const item = await fixture();
  const original = Buffer.from(`\n${metadata()}\n{"type":"event_msg"}\n`);
  await fs.writeFile(item.source, original);
  const repaired = await repairThreadRollout({
    ...item,
    onProgress: async ({ phase, backupDir }) => {
      if (phase === "record") await fs.mkdir(path.join(backupDir, "repair.json"));
    },
  });
  assert.equal(repaired.diagnosis.status, "healthy");
  assert.match(repaired.warning, /会话已经修复/);
  assert.deepEqual(await readRepairBackup(repaired), original);
  assert.equal(await fs.readFile(item.source, "utf8"), `${metadata()}\n{"type":"event_msg"}\n`);
});
