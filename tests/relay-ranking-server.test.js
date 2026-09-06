import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = path.join(root, "relay-ranking-server", "server.py");
const worker = path.join(root, "relay-ranking-server", "worker.js");

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("ranking server exited early");
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("ranking server health timeout");
}

test("ranking server stores only safe aggregate observations and returns scored rankings", async () => {
  const port = await freePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-ranking-server-"));
  const child = spawn(process.platform === "win32" ? "py" : "python3", process.platform === "win32"
    ? ["-3.14", server]
    : [server], {
    env: { ...process.env, RELAY_RANK_HOST: "127.0.0.1", RELAY_RANK_PORT: String(port), RELAY_RANK_DB: path.join(root, "rankings.sqlite3") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitForHealth(url, child);
    const rejected = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_host: "relay.example", model: "model", api_key: "never-accept" }),
    });
    assert.equal(rejected.status, 400);

    const submitted = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Relay Example",
        base_host: "relay.example",
        homepage: "https://relay.example/",
        model: "gpt-6-test",
        models_status: 200,
        models_count: 1,
        model_listed: true,
        efforts: [
          { effort: "low", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true },
          { effort: "medium", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true },
          { effort: "high", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true },
          { effort: "xhigh", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true },
        ],
      }),
    });
    assert.equal(submitted.status, 201);
    const rankings = await (await fetch(`${url}/api/v1/rankings?sort=overall`)).json();
    assert.equal(rankings.items.length, 1);
    assert.equal(rankings.items[0].provider_name, "Relay Example");
    assert.equal(rankings.items[0].average_score, 100);
    assert.equal(rankings.items[0].homepage, "https://relay.example/");
    assert.equal(JSON.stringify(rankings).includes("never-accept"), false);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
  }
});

test("ranking Worker exposes only bounded public routes without embedding secrets", async () => {
  const source = await fs.readFile(worker, "utf8");
  assert.match(source, /https:\/\/api\.vx314490015\.cn/);
  assert.match(source, /\/api\/v1\/rankings/);
  assert.match(source, /\/api\/v1\/audits/);
  assert.match(source, /content-length/);
  assert.match(source, /65536/);
  assert.doesNotMatch(source, /152\.136\.33\.61|eyJ[a-zA-Z0-9_.-]{40,}|api[_-]?key\s*[:=]\s*["']/i);
});
