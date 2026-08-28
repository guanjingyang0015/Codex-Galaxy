import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { modelCanResolveVariants, modelFamilyMatches, prepareGatewayRuntime, ResponsesGateway } from "../responses-gateway.js";

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

async function post(url, body, { authorization = "Bearer relay-secret", headers = {} } = {}) {
  return fetch(url, {
    method: "POST",
    headers: { authorization, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function profile(baseUrl, model = "gpt-5.6-sol") {
  return {
    id: "relay-b",
    kind: "api",
    name: "Relay B",
    baseUrl,
    apiKey: "relay-secret",
    model,
  };
}

test("model-family matching supports arbitrary GPT versions and tiers", () => {
  for (const [configured, candidate] of [
    ["gpt-5.6", "gpt-5.6-sol"],
    ["gpt-5.6", "gpt-5.6-terra"],
    ["gpt-5.6", "gpt-5.6-luna"],
    ["gpt-5.4", "gpt-5.4-pro"],
    ["gpt-5.3", "gpt-5.3-mini"],
    ["gpt-5", "gpt-5.6-sol"],
    ["deepseek-v3", "deepseek-v3.2-special"],
    ["vendor/model", "vendor/model:premium"],
  ]) assert.equal(modelFamilyMatches(configured, candidate), true, `${configured} should match ${candidate}`);
  assert.equal(modelFamilyMatches("gpt-5.4", "gpt-5.6-sol"), false);
  assert.equal(modelFamilyMatches("deepseek-v3", "deepseek-reasoner"), false);
});

test("only version-family IDs are expanded when an exact model is explicitly configured", () => {
  for (const model of ["gpt-5.6", "gpt-5.4", "gpt-5.3", "deepseek-v3", "vendor/model-v2.1"]) {
    assert.equal(modelCanResolveVariants(model), true, `${model} should allow tier discovery`);
  }
  for (const model of ["gpt-5.6-sol", "gpt-5.4-mini", "deepseek-reasoner", "provider/model"]) {
    assert.equal(modelCanResolveVariants(model), false, `${model} should remain exact`);
  }
});

test("ordinary Responses turns use the active profile model and stream SSE unchanged", async (t) => {
  const seen = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
    response.writeHead(200, { "content-type": "text/event-stream", "x-relay": "stream" });
    response.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n");
    response.end("data: [DONE]\n\n");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6", input: "continue" });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("x-relay"), "stream");
  assert.equal(await response.text(), "data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\ndata: [DONE]\n\n");
  assert.equal(seen[0].url, "/v1/responses");
  assert.equal(seen[0].authorization, "Bearer relay-secret");
  assert.equal(seen[0].body.model, "gpt-5.6-sol");
});

test("local compaction metadata replaces only the outbound stale model", async (t) => {
  let received;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ model: received.model, input: received.input }));
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "gpt-5.6-sol"));
  await gateway.start();
  const original = {
    model: "gpt-5.5",
    input: [{ role: "user", content: "history stays intact" }],
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) },
  };

  const response = await post(`${gateway.baseUrl}/responses`, original);

  assert.deepEqual(await response.json(), { model: "gpt-5.6-sol", input: original.input });
  assert.equal(received.model, "gpt-5.6-sol");
  assert.deepEqual(received.input, original.input);
  assert.equal(original.model, "gpt-5.5");
});

test("compaction header and compact endpoint both select the active arbitrary model", async (t) => {
  const seen = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks)) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1/responses`, "deepseek-v3.2-special"));
  await gateway.start();

  await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.5", input: [] }, {
    headers: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) },
  });
  gateway.configure(profile(`${upstreamUrl}/v1/responses`, "vendor/any-model@2026"));
  await post(`${gateway.baseUrl}/responses/compact`, { model: "deepseek-v3.2-special", input: [] });

  assert.deepEqual(seen, [
    { url: "/v1/responses", body: { model: "deepseek-v3.2-special", input: [] } },
    { url: "/v1/responses/compact", body: { model: "vendor/any-model@2026", input: [] } },
  ]);
});

test("every API request uses an arbitrary active profile model without requiring compaction metadata", async (t) => {
  const seen = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push(JSON.parse(Buffer.concat(chunks)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "vendor/any-model@2026"));
  await gateway.start();

  await post(`${gateway.baseUrl}/responses`, { model: "old-official-model", input: "continue" });
  await post(`${gateway.baseUrl}/responses`, { input: "continue without a model" });

  assert.deepEqual(seen.map((body) => body.model), ["vendor/any-model@2026", "vendor/any-model@2026"]);
});

test("model rewriting preserves Codex reasoning level and all non-model request fields", async (t) => {
  let received;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "gpt-5.6-sol"));
  await gateway.start();
  const request = {
    model: "gpt-5.4",
    reasoning: { effort: "xhigh", summary: "auto" },
    tools: [{ type: "function", name: "inspect" }],
    input: [{ role: "user", content: "continue" }],
  };

  await post(`${gateway.baseUrl}/responses`, request);

  assert.deepEqual(received, { ...request, model: "gpt-5.6-sol" });
});

test("upstream status and error body pass through while invalid local auth is rejected", async (t) => {
  let upstreamCalls = 0;
  const upstream = http.createServer(async (_request, response) => {
    upstreamCalls += 1;
    response.writeHead(403, { "content-type": "application/json", "x-request-id": "relay-request" });
    response.end('{"error":{"message":"model unavailable"}}');
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`));
  await gateway.start();

  const unauthorized = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.5" }, { authorization: "Bearer wrong-key" });
  assert.equal(unauthorized.status, 401);
  assert.doesNotMatch(await unauthorized.text(), /relay-secret/);
  assert.equal(upstreamCalls, 0);

  const denied = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6-sol" });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("x-request-id"), "relay-request");
  assert.equal(await denied.text(), '{"error":{"message":"model unavailable"}}');
  assert.equal(upstreamCalls, 1);
});

test("an injected Chromium-style fetch transport preserves streaming responses", async (t) => {
  const calls = [];
  const fetchUpstream = async (url, options) => {
    calls.push({ url, options });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"delta":"through-proxy"}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "x-relay": "chromium" } });
  };
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "continue" }, {
    headers: { "sec-fetch-mode": "cors" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-relay"), "chromium");
  assert.equal(await response.text(), 'data: {"delta":"through-proxy"}\n\ndata: [DONE]\n\n');
  assert.equal(calls[0].url, "https://relay.example/v1/responses");
  assert.equal(calls[0].options.headers.authorization, "Bearer relay-secret");
  assert.equal(calls[0].options.headers["sec-fetch-mode"], undefined);
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].options.body).toString("utf8")), { model: "provider/model", input: "continue" });
});

test("semantic response.completed ends a Responses SSE stream normally", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"done"}\n\n'));
      controller.enqueue(new TextEncoder().encode('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "finish" });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /event: response\.completed/);
  assert.doesNotMatch(text, /upstream_stream_incomplete/);
});

test("semantic response.incomplete remains visible without a false transport error", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "long task" });
  const text = await response.text();

  assert.match(text, /response\.incomplete/);
  assert.match(text, /max_output_tokens/);
  assert.doesNotMatch(text, /upstream_stream_incomplete/);
});

test("explicit failed, cancelled, and error events are not mislabeled as transport EOF", async (t) => {
  for (const terminal of ["response.failed", "response.cancelled", "error"]) {
    const fetchUpstream = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: ${terminal}\ndata: {"type":"${terminal}"}\n\n`));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
    const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
    t.after(async () => { await gateway.stop(); });
    gateway.configure(profile("https://relay.example/v1", "provider/model"));
    await gateway.start();

    const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: terminal });
    const text = await response.text();

    assert.match(text, new RegExp(terminal.replace(".", "\\.")));
    assert.doesNotMatch(text, /upstream_stream_incomplete/);
  }
});

test("fragmented UTF-8 and CRLF SSE boundaries preserve a completed stream", async (t) => {
  const source = 'data: {"type":"response.output_text.delta","delta":"继续"}\r\n\r\nevent: response.completed\r\ndata: {"type":"response.completed"}\r\n\r\n';
  const encoded = Buffer.from(source, "utf8");
  const splitInsideUtf8 = encoded.indexOf(Buffer.from("继续", "utf8")) + 1;
  const splitInsideCrlf = encoded.indexOf(Buffer.from("\r\n\r\n")) + 1;
  const pieces = [
    encoded.subarray(0, splitInsideUtf8),
    encoded.subarray(splitInsideUtf8, splitInsideCrlf),
    encoded.subarray(splitInsideCrlf),
  ];
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "fragmented" });
  const text = await response.text();

  assert.equal(text, source);
  assert.doesNotMatch(text, /upstream_stream_incomplete/);
});

test("a transport error after response.completed does not create a false incomplete warning", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.completed\ndata: {"type":"response.completed"}\n\n'));
      setTimeout(() => controller.error(new Error("socket closed after terminal event")), 10);
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "already complete" });
  const text = await response.text();

  assert.match(text, /response\.completed/);
  assert.doesNotMatch(text, /event: error/);
  assert.doesNotMatch(text, /upstream_stream_incomplete|流式响应中断/);
});

test("an SSE EOF before any terminal event becomes a readable retry error", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "do not stop silently" });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /data: \{"type":"response\.output_text\.delta","delta":"partial"\}/);
  assert.match(text, /event: error/);
  assert.match(text, /upstream_stream_incomplete/);
  assert.match(text, /完成事件前结束/);
});

test("the Node transport also rejects an SSE EOF before a terminal event", async (t) => {
  const upstream = http.createServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "node transport" });
  const text = await response.text();

  assert.match(text, /event: error/);
  assert.match(text, /upstream_stream_incomplete/);
});

test("idle SSE streams send keepalive comments without changing upstream events", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: {\"delta\":\"first\"}\n\n"));
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }, 35);
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream, streamHeartbeatIntervalMs: 10 });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "keepalive" });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.match(text, /: galaxy-keepalive\n\n/);
  assert.match(text, /data: \{"delta":"first"\}/);
  assert.match(text, /data: \[DONE\]/);
});

test("an upstream streaming disconnect becomes a readable SSE error instead of a decode failure", async (t) => {
  const fetchUpstream = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"delta":"partial"}\n\n'));
      setTimeout(() => controller.error(new Error("error decoding response body")), 10);
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://relay.example/v1", "provider/model"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "provider/model", input: "continue" });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /data: \{"delta":"partial"\}/);
  assert.match(text, /event: error/);
  assert.match(text, /流式响应中断/);
  assert.doesNotMatch(text, /error decoding response body/);
});

test("fetch transport connection errors are classified without leaking request data", async (t) => {
  const fetchUpstream = async () => {
    const error = new Error("getaddrinfo ENOTFOUND secret-relay.example");
    error.code = "ENOTFOUND";
    throw error;
  };
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  gateway.configure(profile("https://secret-relay.example/v1"));
  await gateway.start();

  const response = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6-sol", input: "private request body" });
  const text = await response.text();

  assert.equal(response.status, 502);
  assert.match(text, /DNS/);
  assert.doesNotMatch(text, /secret-relay|relay-secret|private request body/);
});

test("runtime switching rolls back the prior gateway profile", async (t) => {
  const upstream = http.createServer((_request, response) => response.end("{}"));
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "model-a"));
  await gateway.start();

  const runtime = await prepareGatewayRuntime(gateway, { ...profile(`${upstreamUrl}/v1`, "deepseek-next"), id: "relay-c" });
  assert.equal(runtime.profile.baseUrl, gateway.baseUrl);
  assert.equal(gateway.status.profileId, "relay-c");
  assert.equal(gateway.status.model, "deepseek-next");

  await runtime.rollback();
  assert.equal(gateway.status.profileId, "relay-b");
  assert.equal(gateway.status.model, "model-a");
  assert.equal(gateway.status.running, true);
});

test("profile resolution uses the relay model catalog and an observed provider model", async () => {
  const calls = [];
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: [{ id: "gpt-5.6", display_name: "GPT-5.6" }, { id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" }, { id: "deepseek-reasoner", display_name: "DeepSeek R1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", "gpt-5.6"), { preferredModels: ["gpt-5.6-sol"] });
  assert.equal(resolved.model, "gpt-5.6-sol");
  assert.equal(resolved.configuredModel, "gpt-5.6");
  assert.equal(resolved.modelResolved, true);
  assert.equal(resolved.singleModel, false);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.sourceId), ["gpt-5.6", "gpt-5.6-sol"]);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.display_name), ["GPT-5.6", "GPT-5.6 Sol"]);
  assert.deepEqual(calls, ["https://relay.example/v1/models"]);
});

test("an explicitly configured tier remains exact even when the catalog has suffixed variants", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response(JSON.stringify({
    data: [{ id: "gpt-5.6-sol" }, { id: "gpt-5.6-sol-premium" }],
  }), { status: 200, headers: { "content-type": "application/json" } }) });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", "gpt-5.6-sol"), {
    preferredModels: ["gpt-5.6-sol-premium"],
  });

  assert.equal(resolved.model, "gpt-5.6-sol");
  assert.deepEqual(resolved.modelCandidates, []);
});

test("profile resolution falls back to a model previously used by the same provider", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response("not supported", { status: 404 }) });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", "gpt-5.6"), { preferredModels: ["gpt-5.6-sol"] });
  assert.equal(resolved.model, "gpt-5.6-sol");
  assert.equal(resolved.configuredModel, "gpt-5.6");
  assert.equal(resolved.singleModel, false);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.sourceId), ["gpt-5.6-sol"]);
});

test("a blank model is discovered from the catalog and prefers a recent compatible thread model", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response(JSON.stringify({
    data: [{ id: "vendor/default-text" }, { id: "deepseek-v3.2-special" }, { id: "gpt-5.6-sol" }],
  }), { status: 200, headers: { "content-type": "application/json" } }) });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", ""), {
    preferredModels: ["not-in-this-relay", "deepseek-v3.2-special"],
  });

  assert.equal(resolved.model, "deepseek-v3.2-special");
  assert.equal(resolved.configuredModel, "");
  assert.equal(resolved.modelResolved, true);
  assert.equal(resolved.singleModel, true);
  assert.deepEqual(resolved.modelCandidates, []);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.sourceId), ["deepseek-v3.2-special"]);
});

test("blank-model discovery ignores recent models that are absent from the relay catalog", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response(JSON.stringify({
    data: [{ id: "relay-first-model" }, { id: "relay-second-model" }],
  }), { status: 200, headers: { "content-type": "application/json" } }) });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", ""), {
    preferredModels: ["unavailable-old-model"],
  });

  assert.equal(resolved.model, "relay-first-model");
  assert.equal(resolved.singleModel, true);
  assert.deepEqual(resolved.modelCandidates, []);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.sourceId), ["relay-first-model"]);
});

test("a non-GPT API exposes one real model name and rewrites stale GPT requests", async (t) => {
  const seen = [];
  const fetchUpstream = async (url, options) => {
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [
        { id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash", context_window: 1048576 },
        { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    seen.push(JSON.parse(Buffer.from(options.body).toString("utf8")).model);
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  const runtime = await prepareGatewayRuntime(gateway, profile("https://relay.example/v1", "gemini-2.5-flash"));

  assert.equal(runtime.profile.singleModel, true);
  assert.deepEqual(runtime.profile.modelCandidates, []);
  assert.equal(runtime.profile.modelCatalog.length, 1);
  assert.equal(runtime.profile.modelCatalog[0].display_name, "Gemini 2.5 Flash");
  assert.equal(runtime.profile.modelCatalog[0].context_window, 1048576);

  const response = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6", input: "continue old task" });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["gemini-2.5-flash"]);
  await runtime.rollback();
});

test("non-GPT fallback remains a strict single model when the catalog is unavailable", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response("not supported", { status: 404 }) });
  const resolved = await gateway.resolveProfile(profile("https://relay.example/v1", "deepseek-v3.2"));

  assert.equal(resolved.singleModel, true);
  assert.deepEqual(resolved.modelCandidates, []);
  assert.deepEqual(resolved.modelCatalog.map((model) => model.sourceId), ["deepseek-v3.2"]);
  assert.equal(resolved.modelCatalog[0].display_name, "deepseek-v3.2");
});

test("a blank model fails clearly when the relay has no readable model catalog", async () => {
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream: async () => new Response("not supported", { status: 404 }) });

  await assert.rejects(
    prepareGatewayRuntime(gateway, profile("https://relay.example/v1", "")),
    /填写模型 ID/,
  );
  assert.equal(gateway.status.running, false);
  assert.equal(gateway.status.profileId, null);
});

test("a successful precise model turn is learned and reused for later compaction", async (t) => {
  const seen = [];
  const learned = [];
  const upstream = http.createServer(async (_request, response) => {
    const chunks = [];
    for await (const chunk of _request) chunks.push(chunk);
    seen.push(JSON.parse(Buffer.concat(chunks)).model);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = new ResponsesGateway({
    port: 0,
    onModelResolved: (value) => learned.push(value),
  });
  t.after(async () => { await gateway.stop(); await close(upstream); });
  gateway.configure(profile(`${upstreamUrl}/v1`, "gpt-5.6"));
  await gateway.start();

  await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6-sol", input: "new API turn" });
  await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.6", input: "old thread" }, {
    headers: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) },
  });

  assert.deepEqual(seen, ["gpt-5.6-sol", "gpt-5.6-sol"]);
  assert.equal(gateway.status.model, "gpt-5.6-sol");
  assert.deepEqual(learned, [{ profileId: "relay-b", configuredModel: "gpt-5.6", resolvedModel: "gpt-5.6-sol" }]);
});

test("a broad-model 403 is retried with an exact catalog candidate before Codex sees it", async (t) => {
  const seen = [];
  const learned = [];
  const fetchUpstream = async (url, options) => {
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.6" }, { id: "gpt-5.6-sol" }] }), { status: 200 });
    }
    const request = JSON.parse(Buffer.from(options.body).toString("utf8"));
    seen.push(request.model);
    if (request.model === "gpt-5.6") {
      return new Response('{"error":{"message":"该令牌无权访问模型 gpt-5.6"}}', { status: 403, headers: { "content-type": "application/json" } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream, onModelResolved: (value) => learned.push(value) });
  t.after(async () => { await gateway.stop(); });
  const runtime = await prepareGatewayRuntime(gateway, profile("https://relay.example/v1", "gpt-5.6"));

  const response = await post(`${gateway.baseUrl}/responses`, {
    model: "gpt-5.5",
    input: "continue old task",
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(seen, ["gpt-5.6", "gpt-5.6-sol"]);
  assert.equal(gateway.status.model, "gpt-5.6-sol");
  assert.deepEqual(learned, [{ profileId: "relay-b", configuredModel: "gpt-5.6", resolvedModel: "gpt-5.6-sol" }]);
  await runtime.rollback();
});

test("non-model request errors are not retried across model tiers", async (t) => {
  const seen = [];
  const fetchUpstream = async (url, options) => {
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-5.4" }, { id: "gpt-5.4-pro" }] }), { status: 200 });
    seen.push(JSON.parse(Buffer.from(options.body).toString("utf8")).model);
    return new Response('{"error":{"message":"invalid tool schema"}}', { status: 400, headers: { "content-type": "application/json" } });
  };
  const gateway = new ResponsesGateway({ port: 0, fetchUpstream });
  t.after(async () => { await gateway.stop(); });
  await prepareGatewayRuntime(gateway, profile("https://relay.example/v1", "gpt-5.4"));

  const response = await post(`${gateway.baseUrl}/responses`, { model: "gpt-5.4", input: "turn" });

  assert.equal(response.status, 400);
  assert.deepEqual(seen, ["gpt-5.4"]);
});

test("a fixed port collision fails before a profile can be activated", async (t) => {
  const occupied = http.createServer((_request, response) => response.end());
  const occupiedUrl = await listen(occupied);
  const port = Number(new URL(occupiedUrl).port);
  const gateway = new ResponsesGateway({ port });
  t.after(async () => { await gateway.stop(); await close(occupied); });
  gateway.configure(profile("https://relay.invalid/v1"));

  await assert.rejects(gateway.start(), new RegExp(`端口 ${port} 已被占用`));
  assert.equal(gateway.status.running, false);
});
