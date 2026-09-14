import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildStatusTimeline, fetchOpenAIStatus, getOpenAIStatusSettings, setOpenAIStatusSettings } from "../openai-status.js";

test("fetches official components and resolves the pinned service", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-"));
  const settingsFile = path.join(dir, "settings.json");
  await setOpenAIStatusSettings(settingsFile, "Codex Web");
  const response = await fetchOpenAIStatus({ settingsFile, fetcher: async () => new Response(JSON.stringify({ status: { description: "All Systems Operational", indicator: "none" }, components: [{ id: "a", name: "Codex API", status: "operational" }, { id: "b", name: "Codex Web", status: "degraded_performance" }] })) });
  assert.equal(response.ok, true);
  assert.equal(response.pinned.name, "Codex Web");
  assert.equal(response.pinned.status, "degraded_performance");
  assert.equal(response.historyAvailable, true);
  assert.equal(response.timeline.length, 90);
  assert.equal((await getOpenAIStatusSettings(settingsFile)).pinnedComponent, "Codex Web");
});

test("builds colored daily history points with incident reasons", () => {
  const timeline = buildStatusTimeline([{
    id: "incident-1",
    name: "Responses API errors",
    status: "resolved",
    impact: "major",
    created_at: "2026-09-10T08:00:00Z",
    resolved_at: "2026-09-12T12:00:00Z",
    incident_updates: [{
      status: "investigating",
      body: "Elevated errors are affecting Responses.",
      created_at: "2026-09-10T08:00:00Z",
    }],
  }], { now: new Date("2026-09-14T12:00:00Z"), days: 7 });
  assert.equal(timeline.length, 7);
  assert.equal(timeline.find((item) => item.date === "2026-09-11").status, "major_outage");
  assert.match(timeline.find((item) => item.date === "2026-09-11").reason, /Elevated errors/);
  assert.equal(timeline.at(-1).status, "operational");
  assert.equal(timeline.at(-1).reason, "");
});

test("returns a safe unavailable result when the official endpoint fails", async () => {
  const result = await fetchOpenAIStatus({ settingsFile: path.join(os.tmpdir(), "missing-status-settings.json"), fetcher: async () => { throw new Error("offline"); } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.components, []);
  assert.match(result.error, /offline/);
});

test("keeps the current status when the optional incident feed is unavailable", async () => {
  const result = await fetchOpenAIStatus({
    settingsFile: path.join(os.tmpdir(), "missing-status-settings.json"),
    fetcher: async (url) => {
      if (String(url).includes("incidents")) throw new Error("incident feed offline");
      return new Response(JSON.stringify({ status: { description: "Operational", indicator: "none" }, components: [{ id: "a", name: "Codex API", status: "operational" }] }));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.historyAvailable, false);
  assert.equal(result.pinned.name, "Codex API");
  assert.equal(result.timeline.length, 90);
});
