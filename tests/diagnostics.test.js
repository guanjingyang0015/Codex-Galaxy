import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiagnosticLogger, diagnosticLogPath, readDiagnosticLog } from "../diagnostics.js";

test("diagnostic logs record failures without persisting sensitive values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-diagnostics-"));
  const logger = createDiagnosticLogger(root, () => "1.9.7");
  const error = new Error("request failed with Bearer sk-test-secret-value");
  await logger.error("switch-failed", error, {
    operation: "switch-profile",
    apiKey: "sk-test-secret-value",
    requestBody: "chat content must not be recorded",
  });

  const file = diagnosticLogPath(root);
  const raw = await fs.readFile(file, "utf8");
  const record = JSON.parse(raw.trim());
  assert.equal(record.level, "error");
  assert.equal(record.event, "switch-failed");
  assert.equal(record.version, "1.9.7");
  assert.match(record.message, /Bearer \[REDACTED\]/);
  assert.equal(record.details.apiKey, "[REDACTED]");
  assert.equal(record.details.requestBody, "[REDACTED]");
  assert.doesNotMatch(raw, /sk-test-secret-value/);
  assert.doesNotMatch(raw, /chat content/);
});

test("diagnostic log reads are bounded and expose the local path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-diagnostics-read-"));
  const logger = createDiagnosticLogger(root, () => "1.9.7");
  for (let index = 0; index < 80; index += 1) await logger.info("test", `entry-${index}`);

  const result = await readDiagnosticLog(root);
  assert.equal(result.path, diagnosticLogPath(root));
  assert.ok(result.bytes > 0);
  assert.match(result.text, /entry-79/);
});
