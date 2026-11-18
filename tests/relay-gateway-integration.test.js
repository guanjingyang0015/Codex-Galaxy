import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { ResponsesGateway, prepareGatewayRuntime } from "../responses-gateway.js";
import { auditRelay } from "../relay-audit.js";

test("auto gateway resolves a root URL and completes a converted tool round-trip through HTTP", async (t) => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
    if (req.url === "/v1/responses") { res.statusCode = 404; return res.end('{"error":{"message":"unsupported endpoint"}}'); }
    assert.equal(req.url, "/v1/chat/completions");
    const body = JSON.parse(text);
    seen.push(body);
    assert.equal(req.headers.authorization, "Bearer synthetic-only");
    const result = body.messages.some((item) => item.role === "tool")
      ? { choices: [{ message: { content: "done" }, finish_reason: "stop" }] }
      : { choices: [{ message: { tool_calls: [{ id: "call_test", function: { name: "probe", arguments: '{"value":"ok"}' } }] }, finish_reason: "tool_calls" }] };
    res.end(JSON.stringify(result));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const gateway = new ResponsesGateway({ port: 0 });
  t.after(async () => { await gateway.stop(); server.close(); server.closeAllConnections(); });
  await prepareGatewayRuntime(gateway, { id: "test", kind: "api", baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "synthetic-only", model: "test-model", runtimeMode: "gateway", relayProtocol: "auto" });
  const send = (input, stream = false) => fetch(`${gateway.baseUrl}/responses`, {
    method: "POST", headers: { authorization: "Bearer synthetic-only", "content-type": "application/json" },
    body: JSON.stringify({ model: "old-model", input, stream, tools: [{ type: "function", name: "probe", parameters: { type: "object", properties: { value: { type: "string" } } } }] }),
  });
  const first = await (await send("call probe")).json();
  const call = first.output[0];
  assert.equal(call.name, "probe");
  const response = await send([{ role: "user", content: "call probe" }, call, { type: "function_call_output", call_id: call.call_id, output: "ok" }], true);
  const events = await response.text();
  assert.match(events, /response\.completed/);
  assert.match(events, /done/);
  assert.equal(seen.length, 2);
  assert.equal(seen.every((item) => item.model === "test-model"), true);
  assert.equal(seen[1].messages.at(-1).tool_call_id, call.call_id);
});

test("auto audit evaluates actual converted Responses metrics without exposing credentials", async () => {
  const result = await auditRelay({ baseUrl: "https://relay.test", apiKey: "synthetic-only", model: "gemini-test", relayProtocol: "auto" }, {
    fetcher: async (url) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "gemini-test" }] });
      if (url.endsWith("/responses")) return Response.json({ error: { message: "unsupported endpoint" } }, { status: 404 });
      assert.equal(url, "https://relay.test/v1/chat/completions");
      return Response.json({ model: "gemini-test", choices: [{ message: { content: "RELAY-CANARY-OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.score.total, 100);
  assert.equal(result.efforts.every((entry) => entry.canary), true);
  assert.equal(JSON.stringify(result).includes("synthetic-only"), false);
});

test("auto audit never counts an adapter-filled model as an upstream model identity declaration", async () => {
  const result = await auditRelay({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic-only", model: "gemini-test", relayProtocol: "auto" }, {
    fetcher: async (url) => url.endsWith("/models")
      ? Response.json({ data: [{ id: "gemini-test" }] })
      : Response.json({ choices: [{ message: { content: "RELAY-CANARY-OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
  });
  assert.deepEqual(result.observedModels, []);
  assert.equal(result.modelVerdict, "listed-only");
  assert.ok(result.score.total < 80);
});
