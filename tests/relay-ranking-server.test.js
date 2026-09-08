import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = path.join(root, "relay-ranking-server", "server.py");
const worker = path.join(root, "relay-ranking-server", "worker.js");
const adminLinks = path.join(root, "relay-ranking-server", "admin_links.py");
const adminAuth = path.join(root, "relay-ranking-server", "admin_auth.py");
const adminAuthSetup = path.join(root, "relay-ranking-server", "admin_auth_setup.py");
const adminWeb = path.join(root, "relay-ranking-server", "admin_web.py");
const pythonCommand = process.env.GALAXY_TEST_PYTHON || (process.platform === "win32" ? "py" : "python3");

function pythonArgs(script, ...args) {
  return process.platform === "win32" && !process.env.GALAXY_TEST_PYTHON
    ? ["-3.14", script, ...args]
    : [script, ...args];
}

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
  const child = spawn(pythonCommand, pythonArgs(server), {
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
        homepage: "https://www.relay.example/",
        model: "gpt-6-test",
        expected_model: "gpt-6-test",
        observed_model: "gpt-6-test",
        model_verdict: "exact",
        matches_desired_model: true,
        models_status: 200,
        models_count: 1,
        model_listed: true,
        efforts: [
          { effort: "low", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "medium", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "high", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "xhigh", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
        ],
      }),
    });
    assert.equal(submitted.status, 201);
    const rankings = await (await fetch(`${url}/api/v1/rankings?sort=overall`)).json();
    assert.equal(rankings.items.length, 1);
    assert.equal(rankings.items[0].provider_name, "Relay Example");
    assert.equal(rankings.items[0].ranking_score, 100);
    assert.equal(rankings.items[0].homepage, "https://relay.example/");
    assert.equal(rankings.items[0].expected_model, "gpt-6-test");
    assert.equal(rankings.items[0].observed_model, "gpt-6-test");
    assert.equal(JSON.stringify(rankings).includes("never-accept"), false);
    const admin = spawn(pythonCommand, pythonArgs(adminLinks, "set", "relay.example", "https://owner.example/"), {
      env: { ...process.env, RELAY_RANK_DB: path.join(root, "rankings.sqlite3") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(await new Promise((resolve) => admin.once("close", resolve)), 0);
    const overridden = await (await fetch(`${url}/api/v1/rankings`)).json();
    assert.equal(overridden.items[0].homepage, "https://owner.example/");

    const firstDatabase = new DatabaseSync(path.join(root, "rankings.sqlite3"));
    firstDatabase.prepare("update audits set created_at = ? where base_host = ?").run(
      new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      "relay.example",
    );
    firstDatabase.close();
    const lower = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Relay Example",
        base_host: "relay.example",
        homepage: "https://relay.example/",
        model: "gpt-6-test",
        expected_model: "gpt-6-test",
        observed_model: "gpt-6-test",
        expected_model_listed: true,
        models_status: 200,
        model_listed: true,
        efforts: [{ effort: "low", status: 200, elapsed_ms: 9000, ok: true, canary: true }],
      }),
    });
    const lowerBody = await lower.json();
    const sevenDay = await (await fetch(`${url}/api/v1/rankings?model=gpt-6-test`)).json();
    assert.equal(sevenDay.items[0].ranking_score, lowerBody.score);
    assert.equal(sevenDay.items[0].recent_7d_samples, 1);
    assert.equal(sevenDay.items[0].history_90d_max, 100);
    const otherModel = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Relay Example",
        base_host: "relay.example",
        model: "deepseek-reasoner",
        expected_model: "deepseek-reasoner",
        observed_model: "deepseek-reasoner",
        expected_model_listed: true,
        models_status: 200,
        model_listed: true,
        efforts: [
          { effort: "repeat-1", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
        ],
      }),
    });
    assert.equal(otherModel.status, 201);
    const allModels = await (await fetch(`${url}/api/v1/rankings`)).json();
    assert.equal(allModels.items.filter((item) => item.base_host === "relay.example").length, 2);
    assert.equal(allModels.items.some((item) => item.model === "deepseek-reasoner"), true);

    const mismatch = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Mismatch Relay",
        base_host: "mismatch.example",
        model: "gpt-6",
        expected_model: "gpt-6",
        observed_model: "gpt-5.6-sol",
        model_verdict: "exact",
        models_status: 200,
        models_count: 1,
        model_listed: true,
        efforts: [
          { effort: "low", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "medium", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "high", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
          { effort: "xhigh", status: 200, elapsed_ms: 1000, ok: true, canary: true, has_response_id: true, usage: { total_tokens: 2 } },
        ],
      }),
    });
    const mismatchBody = await mismatch.json();
    assert.equal(mismatchBody.score, 49);
    assert.equal(mismatchBody.model_verdict, "mismatch");
    const recent = await (await fetch(`${url}/api/v1/rankings?sort=recent`)).json();
    const mismatchRanking = recent.items.find((item) => item.base_host === "mismatch.example");
    assert.equal(mismatchRanking.homepage, "https://mismatch.example/");
    assert.equal(mismatchRanking.observed_model, "gpt-5.6-sol");
    const filtered = await (await fetch(`${url}/api/v1/rankings?model=gpt-6-test`)).json();
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0].expected_model, "gpt-6-test");
    assert.equal(typeof filtered.history_90d_max, "number");
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

test("owner-only link SSH CLI remains local and contains no HTTP server", async () => {
  const source = await fs.readFile(adminLinks, "utf8");
  assert.match(source, /argparse/);
  assert.match(source, /link_overrides/);
  assert.doesNotMatch(source, /http\.server|BaseHTTPRequestHandler|do_POST/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-admin-links-"));
  const database = path.join(root, "rankings.sqlite3");
  for (const args of [["set", "relay.example", "https://relay.example/"], ["list"], ["delete", "relay.example"]]) {
    const child = spawn(pythonCommand, pythonArgs(adminLinks, ...args), {
      env: { ...process.env, RELAY_RANK_DB: database },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    const exitCode = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0, Buffer.concat(output).toString("utf8"));
  }
});

test("web admin requires login and CSRF before changing ranking links", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-web-admin-"));
  const database = path.join(fixtureRoot, "rankings.sqlite3");
  const authFile = path.join(fixtureRoot, "admin_auth.json");
  const setup = spawn(pythonCommand, pythonArgs(adminAuthSetup, "--path", authFile, "--username", "synthetic-owner", "--password-stdin"), { stdio: ["pipe", "pipe", "pipe"] });
  setup.stdin.end("synthetic-password\nsynthetic-password\n");
  assert.equal(await new Promise((resolve) => setup.once("close", resolve)), 0);
  const storedAuth = await fs.readFile(authFile, "utf8");
  assert.doesNotMatch(storedAuth, /synthetic-password/);

  const port = await freePort();
  const child = spawn(pythonCommand, pythonArgs(server), {
    env: {
      ...process.env,
      RELAY_RANK_HOST: "127.0.0.1",
      RELAY_RANK_PORT: String(port),
      RELAY_RANK_DB: database,
      RELAY_RANK_ADMIN_AUTH: authFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitForHealth(url, child);
    const audit = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Admin Test",
        base_host: "admin.example",
        model: "test-model",
        expected_model: "test-model",
        observed_model: "test-model",
        expected_model_listed: true,
        models_status: 200,
        efforts: [{ effort: "repeat-1", status: 200, elapsed_ms: 1000, ok: true, canary: true }],
      }),
    });
    assert.equal(audit.status, 201);
    const secondModelAudit = await fetch(`${url}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_name: "Admin Test",
        base_host: "admin.example",
        model: "admin-other-model",
        expected_model: "admin-other-model",
        observed_model: "admin-other-model",
        expected_model_listed: true,
        models_status: 200,
        efforts: [{ effort: "repeat-1", status: 200, elapsed_ms: 1000, ok: true, canary: true }],
      }),
    });
    assert.equal(secondModelAudit.status, 201);

    const loginPage = await fetch(`${url}/admin/`);
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /排行榜后台登录/);
    assert.match(loginPage.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);

    const denied = await fetch(`${url}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "synthetic-owner", password: "wrong" }),
      redirect: "manual",
    });
    assert.equal(denied.status, 401);

    const login = await fetch(`${url}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "synthetic-owner", password: "synthetic-password" }),
      redirect: "manual",
    });
    assert.equal(login.status, 303);
    const setCookie = login.headers.get("set-cookie") || "";
    assert.match(setCookie, /__Host-cg_admin=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(";")[0];

    const dashboard = await fetch(`${url}/admin/`, { headers: { cookie } });
    const dashboardBody = await dashboard.text();
    assert.match(dashboardBody, /新增或修改链接/);
    assert.match(dashboardBody, /使用默认链接/);
    assert.match(dashboardBody, /已自定义/);
    assert.match(dashboardBody, /排行榜网站链接/);
    assert.match(dashboardBody, /本站共 2 个模型，链接共用/);
    const csrf = dashboardBody.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(csrf);

    const rejectedCsrf = await fetch(`${url}/admin/set`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ base_host: "admin.example", homepage: "https://owner.example/" }),
    });
    assert.equal(rejectedCsrf.status, 400);

    const saved = await fetch(`${url}/admin/set`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, base_host: "admin.example", homepage: "https://owner.example/" }),
    });
    assert.equal(saved.status, 200);
    assert.match(await saved.text(), /链接已保存/);
    const overridden = await (await fetch(`${url}/api/v1/rankings`)).json();
    assert.equal(overridden.items[0].homepage, "https://owner.example/");

    const removed = await fetch(`${url}/admin/delete`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, base_host: "admin.example" }),
    });
    assert.equal(removed.status, 200);
    const restored = await (await fetch(`${url}/api/v1/rankings`)).json();
    assert.equal(restored.items[0].homepage, "https://admin.example/");

    const logout = await fetch(`${url}/admin/logout`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf }),
      redirect: "manual",
    });
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
  }
});

test("web admin sources contain no embedded credential values", async () => {
  const source = await Promise.all([adminAuth, adminAuthSetup, adminWeb].map((file) => fs.readFile(file, "utf8")));
  assert.match(source.join("\n"), /pbkdf2_hmac/);
  assert.doesNotMatch(source.join("\n"), /g15611110015|15611110015/);
});
