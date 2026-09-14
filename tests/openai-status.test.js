import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchOpenAIStatus, getOpenAIStatusSettings, setOpenAIStatusSettings } from "../openai-status.js";

test("fetches official components and resolves the pinned service", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-"));
  const settingsFile = path.join(dir, "settings.json");
  await setOpenAIStatusSettings(settingsFile, "Codex Web");
  const response = await fetchOpenAIStatus({ settingsFile, fetcher: async () => new Response(JSON.stringify({ status: { description: "All Systems Operational", indicator: "none" }, components: [{ id: "a", name: "Codex API", status: "operational" }, { id: "b", name: "Codex Web", status: "degraded_performance" }] })) });
  assert.equal(response.ok, true);
  assert.equal(response.pinned.name, "Codex Web");
  assert.equal(response.pinned.status, "degraded_performance");
  assert.equal((await getOpenAIStatusSettings(settingsFile)).pinnedComponent, "Codex Web");
});

test("returns a safe unavailable result when the official endpoint fails", async () => {
  const result = await fetchOpenAIStatus({ settingsFile: path.join(os.tmpdir(), "missing-status-settings.json"), fetcher: async () => { throw new Error("offline"); } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.components, []);
  assert.match(result.error, /offline/);
});
