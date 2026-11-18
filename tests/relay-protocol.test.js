import test from "node:test";
import assert from "node:assert/strict";
import { convertRelayRequest, createRelayTransport, relayEndpoint, relayModelsUrl } from "../relay-protocol.js";

const tool = { type: "function", name: "get_value", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } };
const request = { model: "gemini-test", input: "Reply OK", tools: [tool], store: false };
const json = (data, status = 200) => Response.json(data, { status });
function sse(parts, { fragment = false, closed = true } = {}) {
  const text = parts.map((part) => `data: ${JSON.stringify(part)}\r\n\r\n`).join("");
  let cancelled = false;
  return {
    response: new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        if (fragment) for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
        else controller.enqueue(bytes);
        if (closed) controller.close();
      },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "text/event-stream" } }),
    get cancelled() { return cancelled; },
  };
}
const eventsOf = (text) => text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)));

test("ordinary Gemini/Claude/chat turns tolerate optional web_search while explicit search stays blocked", () => {
  for (const protocol of ["chat", "anthropic", "gemini"]) {
    const converted = convertRelayRequest({ ...request, tools: [{ type: "web_search" }, tool], tool_choice: "auto" }, protocol);
    assert.equal(converted.specs.size, 1);
    const noFunctions = convertRelayRequest({ ...request, tools: [{ type: "web_search" }], tool_choice: "auto" }, protocol);
    assert.equal(noFunctions.body.tools, undefined);
    assert.equal(noFunctions.body.toolConfig, undefined);
    assert.throws(() => convertRelayRequest({ ...request, tools: [{ type: "web_search" }], tool_choice: "required" }, protocol), /搜索/);
    assert.throws(() => convertRelayRequest({ ...request, input: [{ type: "web_search_call", id: "search" }] }, protocol), /输入项/);
  }
});

test("relay URLs accept root, /v1, endpoint and Gemini catalog addresses without duplicate segments", () => {
  for (const base of ["https://relay.test", "https://relay.test/v1", "https://relay.test/v1/responses", "https://relay.test/v1/chat/completions", "https://relay.test/v1/messages", "https://relay.test/v1beta/models"]) {
    assert.equal(relayEndpoint(base, "responses"), "https://relay.test/v1/responses");
    assert.equal(relayEndpoint(base, "chat"), "https://relay.test/v1/chat/completions");
  }
  assert.equal(relayModelsUrl("https://relay.test/v1beta/models").toString(), "https://relay.test/v1beta/models");
  assert.equal(relayEndpoint("https://relay.test/prefix/v1", "gemini", "gemini-x", true), "https://relay.test/prefix/v1beta/models/gemini-x:streamGenerateContent?alt=sse");
  assert.throws(() => relayEndpoint("https://user:secret@relay.test", "responses"), /Base URL/);
  assert.throws(() => relayEndpoint("https://relay.test?key=private", "responses"), /Base URL/);
});

test("Responses-native transport preserves the request, stream, errors and selected model", async () => {
  const raw = json({ id: "real-response", model: "actual-model", output: [] });
  const calls = [];
  const transport = createRelayTransport({ baseUrl: "https://relay.test", apiKey: "synthetic", fetcher: async (url, options) => { calls.push({ url, options }); return raw; } });
  assert.equal(await transport.request(request), raw);
  assert.deepEqual(JSON.parse(calls[0].options.body), request);
  assert.equal(calls[0].options.redirect, "error");
});

for (const status of [401, 403, 429, 500, 502, 503]) test(`no protocol retries on upstream status ${status}`, async () => {
  let count = 0;
  const transport = createRelayTransport({ baseUrl: "https://relay.test", apiKey: "synthetic", fetcher: async () => { count++; return json({ error: { message: "upstream failed" } }, status); } });
  assert.equal((await transport.request(request)).status, status);
  assert.equal(count, 1);
});

test("a missing model is not confused with a missing endpoint", async () => {
  let count = 0;
  const transport = createRelayTransport({ baseUrl: "https://relay.test", apiKey: "synthetic", fetcher: async () => { count++; return json({ error: { code: "model_not_found", message: "model does not exist" } }, 404); } });
  assert.equal((await transport.request(request)).status, 404);
  assert.equal(count, 1);
});

test("parallel tool-call history becomes one assistant tool_calls message before tool results", () => {
  const converted = convertRelayRequest({ ...request, input: [
    { type: "function_call", name: "get_value", call_id: "a", arguments: '{"value":"a"}' },
    { type: "function_call", name: "get_value", call_id: "b", arguments: '{"value":"b"}' },
    { type: "function_call_output", call_id: "a", output: "A" },
    { type: "function_call_output", call_id: "b", output: "B" },
  ] }, "chat");
  assert.equal(converted.body.messages[0].tool_calls.length, 2);
  assert.deepEqual(converted.body.messages.slice(1).map((message) => message.tool_call_id), ["a", "b"]);
});

test("only endpoint errors select a fallback; successful protocol is remembered per model", async () => {
  const urls = [];
  const transport = createRelayTransport({ baseUrl: "https://relay.test", apiKey: "synthetic", fetcher: async (url) => {
    urls.push(url);
    if (url.endsWith("/responses")) return json({ error: { message: "endpoint missing" } }, 404);
    return json({ model: "actual-gemini", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  } });
  for (let index = 0; index < 2; index++) {
    const result = await (await transport.request(request)).json();
    assert.equal(result.status, "completed");
    assert.equal(result.model, "actual-gemini");
    assert.equal(result.output[0].content[0].text, "OK");
    assert.deepEqual(result.usage, { input_tokens: 2, output_tokens: 1, total_tokens: 3 });
  }
  assert.deepEqual(urls, ["https://relay.test/v1/responses", "https://relay.test/v1/chat/completions", "https://relay.test/v1/chat/completions"]);
});

test("Chat Completions converts namespace/custom tools and sends the corresponding result in the next round", async () => {
  const sent = [];
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic", fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    return sent.length === 1
      ? json({ choices: [{ message: { tool_calls: [{ id: "provider-call", function: { name: body.tools[0].function.name, arguments: '{"input":"*** Begin Patch\\n*** End Patch"}' } }] }, finish_reason: "tool_calls" }] })
      : json({ choices: [{ message: { content: "completed" }, finish_reason: "stop" }] });
  } });
  const first = { model: "model", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "apply_patch" }] }], input: "patch" };
  const result = await (await transport.request(first)).json();
  const call = result.output[0];
  assert.equal(call.type, "custom_tool_call");
  assert.equal(call.name, "apply_patch");
  assert.equal(call.namespace, "functions");
  assert.match(call.input, /Begin Patch/);
  const final = await (await transport.request({ ...first, input: [{ role: "user", content: "patch" }, call, { type: "custom_tool_call_output", call_id: call.call_id, output: "Applied" }] })).json();
  assert.equal(final.status, "completed");
  assert.equal(sent[1].messages[1].tool_calls[0].id, call.call_id);
  assert.deepEqual(JSON.parse(sent[1].messages[1].tool_calls[0].function.arguments), { input: call.input });
  assert.equal(sent[1].messages[2].tool_call_id, call.call_id);
  assert.equal(sent[1].messages[2].content, "Applied");
});

test("Chat SSE preserves split UTF-8 and parallel fragmented tool arguments with valid Responses lifecycle", async () => {
  const upstream = sse([
    { choices: [{ delta: { content: "你好" }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "get_value", arguments: '{"value":' } }, { index: 1, id: "b", function: { name: "get_value", arguments: '{"value":"b"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, finish_reason: "tool_calls" }] },
  ], { fragment: true });
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic", fetcher: async () => upstream.response });
  const response = await transport.request({ ...request, stream: true });
  const events = eventsOf(await response.text());
  assert.equal(events[0].type, "response.created");
  assert.equal(events.at(-1).type, "response.completed");
  assert.equal(events.find((event) => event.type === "response.output_text.delta").delta, "你好");
  const calls = events.at(-1).response.output.filter((item) => item.type === "function_call");
  assert.deepEqual(calls.map((call) => JSON.parse(call.arguments).value), ["a", "b"]);
  assert.equal(new Set(events.map((event) => event.sequence_number)).size, events.length);
});

test("Anthropic tool use, usage and tool result round-trip retain association", async () => {
  const sent = [];
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/messages", apiKey: "synthetic", fetcher: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    assert.equal(options.headers["x-api-key"], "synthetic");
    return json({ type: "message", model: "claude-model", content: [{ type: "tool_use", id: "anthropic-call", name: "get_value", input: { value: "ok" } }], usage: { input_tokens: 3, output_tokens: 2 }, stop_reason: "tool_use" });
  } });
  const result = await (await transport.request(request)).json();
  const call = result.output[0];
  assert.equal(call.call_id, "anthropic-call");
  assert.equal(result.model, "claude-model");
  await transport.request({ ...request, input: [{ role: "user", content: "value" }, call, { type: "function_call_output", call_id: call.call_id, output: "ok" }] });
  assert.equal(sent[1].messages.at(-1).content[0].tool_use_id, "anthropic-call");
});

test("Anthropic stream builds tool call fragments and requires message_stop", async () => {
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/messages", apiKey: "synthetic", fetcher: async () => sse([
    { type: "message_start", message: { model: "claude-test", usage: { input_tokens: 4, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "anthropic-call", name: "get_value", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"value":"yes"}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ]).response });
  const events = eventsOf(await (await transport.request({ ...request, stream: true })).text());
  assert.equal(events.at(-1).type, "response.completed");
  assert.deepEqual(events.at(-1).response.usage, { input_tokens: 4, output_tokens: 3, total_tokens: 7 });
  assert.equal(events.at(-1).response.output[0].arguments, '{"value":"yes"}');
});

test("Gemini native endpoint retains thought signatures in memory for tool-result continuation", async () => {
  const sent = [];
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1beta/models", apiKey: "synthetic", fetcher: async (url, options) => {
    assert.match(url, /v1beta\/models\/gemini-test:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "synthetic");
    assert.equal(url.includes("synthetic"), false);
    sent.push(JSON.parse(options.body));
    return sent.length === 1
      ? json({ candidates: [{ content: { parts: [{ functionCall: { name: "get_value", args: { value: "yes" } }, thoughtSignature: "opaque-provider-signature" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })
      : json({ candidates: [{ content: { parts: [{ text: "yes" }] }, finishReason: "STOP" }] });
  } });
  const first = await (await transport.request(request)).json();
  const call = first.output[0];
  assert.equal(JSON.stringify(first).includes("opaque-provider-signature"), false);
  const handedOff = createRelayTransport({ baseUrl: "https://relay.test/v1beta/models", apiKey: "synthetic", state: transport.snapshot(), fetcher: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return json({ candidates: [{ content: { parts: [{ text: "yes" }] }, finishReason: "STOP" }] });
  } });
  const last = await (await handedOff.request({ ...request, input: [{ role: "user", content: "value" }, call, { type: "function_call_output", call_id: call.call_id, output: "yes" }] })).json();
  assert.equal(sent[1].contents[1].parts[0].thoughtSignature, "opaque-provider-signature");
  assert.equal(sent[1].contents[2].parts[0].functionResponse.name, "get_value");
  assert.equal(last.output[0].content[0].text, "yes");
});

test("Gemini models normalize native names and native SSE produces completed output", async () => {
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1beta/models", apiKey: "synthetic", fetcher: async (url) => {
    if (url.endsWith("/models")) return json({ models: [{ name: "models/gemini-test", displayName: "Gemini test" }] });
    assert.match(url, /:streamGenerateContent\?alt=sse$/);
    return sse([{ candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] }]).response;
  } });
  assert.equal((await (await transport.models()).json()).data[0].id, "gemini-test");
  const events = eventsOf(await (await transport.request({ ...request, stream: true })).text());
  assert.equal(events.at(-1).response.output[0].content[0].text, "OK");
});

test("adapter fails on incomplete streams, malformed tool JSON and unknown service tools", async () => {
  const make = (payload) => createRelayTransport({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic", fetcher: async () => payload });
  const truncated = make(sse([{ choices: [{ delta: { content: "partial" } }] }]).response);
  await assert.rejects((await truncated.request({ ...request, stream: true })).text(), /转换失败|不完整/);
  const broken = make(json({ choices: [{ message: { tool_calls: [{ id: "call", function: { name: "get_value", arguments: "{" } }] }, finish_reason: "tool_calls" }] }));
  await assert.rejects(broken.request(request), /JSON/);
  const lengthLimited = make(json({ choices: [{ message: { tool_calls: [{ id: "call", function: { name: "get_value", arguments: '{"value":"partial"}' } }] }, finish_reason: "length" }] }));
  await assert.rejects(lengthLimited.request(request), /截断/);
  assert.throws(() => convertRelayRequest({ ...request, tools: [{ type: "web_search" }], tool_choice: { type: "web_search" } }, "chat"), /搜索/);
  assert.throws(() => convertRelayRequest({ ...request, tools: [{ type: "file_search" }] }, "chat"), /工具类型/);
  assert.throws(() => convertRelayRequest({ ...request, previous_response_id: "resp_old" }, "chat"), /previous_response_id/);
});

test("remote compaction never silently replays an ordinary generation on a non-Responses protocol", async () => {
  let count = 0;
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic", fetcher: async () => { count++; return json({}); } });
  await assert.rejects(transport.request(request, { endpoint: "/responses/compact" }), /压缩/);
  assert.equal(count, 0);
});

test("consumer cancellation releases the converted upstream stream before its first delta", async () => {
  const upstream = sse([], { closed: false });
  const transport = createRelayTransport({ baseUrl: "https://relay.test/v1/chat/completions", apiKey: "synthetic", fetcher: async () => upstream.response });
  const response = await transport.request({ ...request, stream: true });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(upstream.cancelled, true);
});
