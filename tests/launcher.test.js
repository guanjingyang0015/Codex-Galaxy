import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildResumeArgs, buildMacTerminalArgs, formatResumeCommand, waitForSpawn } from "../launcher.js";

test("resume passes an arbitrary target model without changing the thread id", () => {
  assert.deepEqual(buildResumeArgs("thread-from-gpt-5.5", "deepseek-reasoner"), ["resume", "thread-from-gpt-5.5", "--model", "deepseek-reasoner"]);
  assert.equal(formatResumeCommand("thread-from-gpt-5.5", "provider/model-x"), 'codex resume "thread-from-gpt-5.5" --model "provider/model-x"');
});

test("resume can preserve the thread model when an API gateway supplies the outbound model", () => {
  assert.deepEqual(buildResumeArgs("existing-thread", null), ["resume", "existing-thread"]);
  assert.equal(formatResumeCommand("existing-thread", null), 'codex resume "existing-thread"');
});

test("macOS launcher opens a visible Terminal with safely quoted paths and model ids", () => {
  const args = buildMacTerminalArgs("/Applications/Codex Tools/codex", buildResumeArgs("thread'id", "vendor/model"), "/Users/test/My Project");
  assert.equal(args[0], "-e");
  assert.match(args[1], /tell application "Terminal" to do script/);
  assert.match(args[1], /cd -- '\/Users\/test\/My Project'/);
  assert.ok(args[1].includes(`'thread'\\"'\\"'id'`));
  assert.equal(args.at(-1), 'tell application "Terminal" to activate');
});

test("launcher returns spawn failures instead of leaving an unhandled error", async () => {
  const child = new EventEmitter();
  const started = waitForSpawn(child);
  queueMicrotask(() => child.emit("error", new Error("CLI unavailable")));
  await assert.rejects(started, /CLI unavailable/);
});
