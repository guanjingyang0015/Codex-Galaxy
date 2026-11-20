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

test("full gateway exit closes an active stream and releases its listener", async (t) => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"waiting\"}\n\n");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: fetch });
  t.after(async () => { await gateway.stop({ force: true }); upstream.closeAllConnections(); await close(upstream); });
  gateway.configure({ id: "relay-b", kind: "api", baseUrl: `${upstreamUrl}/v1`, apiKey: "relay-secret", model: "synthetic" });
  await gateway.start();
  const url = `${gateway.baseUrl}/responses`;
  const send = () => fetch(url, {
    method: "POST", headers: { authorization: "Bearer relay-secret", "content-type": "application/json" },
    body: JSON.stringify({ input: "synthetic", stream: true }), signal: AbortSignal.timeout(5000),
  });
  const response = await send();
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await gateway.stop({ force: true });
  assert.equal(gateway.status.running, false);
  await assert.rejects(send());
});

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

test("auto Gemini helper handoff carries tool signatures only through stdin, never the host-state file", async (t) => {
  let round = 0;
  const upstream = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    assert.equal(request.url, "/v1beta/models/gemini-test:generateContent");
    const body = JSON.parse(text);
    round++;
    if (round === 2) assert.equal(body.contents[1].parts[0].thoughtSignature, "private-provider-signature");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ candidates: [{ content: { parts: round === 1
      ? [{ functionCall: { name: "probe", args: { marker: "ok" } }, thoughtSignature: "private-provider-signature" }]
      : [{ text: "done" }] }, finishReason: "STOP" }] }));
  });
  const base = await listen(upstream);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-auto-host-"));
  const gateway = new ResponsesGateway({ port: 0 });
  gateway.configure({ id: "native-gemini", kind: "api", model: "gemini-test", baseUrl: `${base}/v1beta/models`, apiKey: "synthetic-key", relayProtocol: "auto" });
  await gateway.start();
  t.after(async () => { await gateway.stop(); await stopOwnedGatewayHost(root); await close(upstream); await fs.rm(root, { recursive: true, force: true }); });
  const tool = { type: "function", name: "probe", parameters: { type: "object", properties: { marker: { type: "string" } } } };
  const send = (url, input) => fetch(`${url}/responses`, { method: "POST", headers: { authorization: "Bearer synthetic-key", "content-type": "application/json" }, body: JSON.stringify({ model: "gemini-test", input, tools: [tool] }) });
  const input = [{ role: "user", content: "call probe" }];
  const first = await (await send(gateway.baseUrl, input)).json();
  const call = first.output[0];
  const handoff = await handoffGatewayToHost({ gateway, root, timeoutMs: 5000 });
  const metadata = await fs.readFile(stateFile(root), "utf8");
  assert.doesNotMatch(metadata, /private-provider-signature|synthetic-key/);
  const second = await (await send(`http://127.0.0.1:${handoff.port}/v1`, [...input, call, { type: "function_call_output", call_id: call.call_id, output: "ok" }])).json();
  assert.equal(second.output[0].content[0].text, "done");
  assert.equal(round, 2);
});
