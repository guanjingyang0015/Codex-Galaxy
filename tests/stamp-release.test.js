import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("release stamping writes GitHub metadata only into a candidate release", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-stamp-release-"));
  await fs.mkdir(path.join(fixture, "scripts"), { recursive: true });
  await fs.copyFile(path.join(process.cwd(), "scripts", "stamp-release.mjs"), path.join(fixture, "scripts", "stamp-release.mjs"));
  await fs.copyFile(path.join(process.cwd(), "release-info.js"), path.join(fixture, "release-info.js"));
  await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ version: "1.9.7" }));

  const sha = "0123456789abcdef0123456789abcdef01234567";
  const runId = "123456789";
  const env = { ...process.env, GITHUB_SHA: sha, GITHUB_RUN_ID: runId };
  await execFileAsync(process.execPath, [path.join(fixture, "scripts", "stamp-release.mjs")], { cwd: fixture, env });

  const stamped = await fs.readFile(path.join(fixture, "release-info.js"), "utf8");
  assert.match(stamped, new RegExp(`commit: "${sha}"`));
  assert.match(stamped, new RegExp(`actionsRun: "${runId}"`));

  await assert.rejects(
    execFileAsync(process.execPath, [path.join(fixture, "scripts", "stamp-release.mjs")], { cwd: fixture, env }),
    /不是可写入的候选状态/,
  );
});
