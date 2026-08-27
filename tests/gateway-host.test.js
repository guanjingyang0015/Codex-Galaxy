import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { ResponsesGateway } from "../responses-gateway.js";
import { handoffGatewayToHost, OWNER, readGatewayHostState, stateFile, stopOwnedGatewayHost } from "../electron/gateway-host.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

test("API gateway can be handed to a detached host and stopped without touching Codex", async (t) => {
  const upstream = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamUrl = await listen(upstream);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-host-"));
  const gateway = new ResponsesGateway({ port: 0 });
  gateway.configure({
    id: "relay-b",
    kind: "api",
    baseUrl: `${upstreamUrl}/v1`,
    apiKey: "relay-secret",
    model: "provider/model",
  });
  await gateway.start();
  t.after(async () => {
    await gateway.stop();
    await stopOwnedGatewayHost(root);
    await close(upstream);
    await fs.rm(root, { recursive: true, force: true });
  });

  const handoff = await handoffGatewayToHost({ gateway, root, timeoutMs: 5000 });
  assert.equal(handoff.handedOff, true);
  assert.equal(gateway.status.running, false);
  const state = await readGatewayHostState(root);
  assert.equal(state.owner, "codex-galaxy-gateway-host-v1");
  assert.equal(state.status, "ready");
  assert.equal(state.port, handoff.port);

  const response = await fetch(`http://127.0.0.1:${handoff.port}/v1/responses`, {
    method: "POST",
    headers: { authorization: "Bearer relay-secret", "content-type": "application/json" },
    body: JSON.stringify({ model: "provider/model", input: "still running" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const stopped = await stopOwnedGatewayHost(root);
  assert.equal(stopped.stopped, true);
  await assert.rejects(fetch(`http://127.0.0.1:${handoff.port}/v1/responses`, {
    method: "POST",
    headers: { authorization: "Bearer relay-secret", "content-type": "application/json" },
    body: "{}",
  }));
});

test("gateway-host cleanup never terminates a PID solely from its state file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-host-safety-"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(stateFile(root), JSON.stringify({
    owner: OWNER,
    pid: child.pid,
    token: "untrusted-state-token",
    status: "ready",
  }));

  const stopped = await stopOwnedGatewayHost(root, { timeoutMs: 1 });

  assert.equal(stopped.stopped, false);
  assert.equal(stopped.timedOut, true);
  assert.equal(child.exitCode, null);
});
