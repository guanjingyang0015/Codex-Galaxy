import test from "node:test";
import assert from "node:assert/strict";
import { auditRelay } from "../relay-audit.js";
import { homepageMatchesBaseHost, sanitizeAuditForRanking } from "../relay-ranking.js";

function fakeFetcher(url, options) {
  if (url.endsWith("/models")) {
    return Promise.resolve(new Response(JSON.stringify({
      data: [{
        id: "gpt-6-test",
        supported_reasoning_levels: [
          { effort: "low", description: "low" },
          { effort: "medium", description: "medium" },
        ],
        context_window: 128000,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  const body = JSON.parse(options.body);
  return Promise.resolve(new Response(JSON.stringify({
    id: `msg-${body.reasoning.effort}`,
    output_text: "RELAY-CANARY-OK",
    usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

test("relay audit checks models and each reasoning effort without retaining response bodies", async () => {
  const result = await auditRelay({
    baseUrl: "https://relay.example/v1",
    apiKey: "synthetic-secret",
    model: "gpt-6-test",
  }, { fetcher: fakeFetcher, timeoutMs: 1000 });

  assert.equal(result.status, "ok");
  assert.equal(result.model, "gpt-6-test");
  assert.equal(result.modelsCount, 1);
  assert.equal(result.modelListed, true);
  assert.deepEqual(result.declaredReasoningLevels, ["low", "medium"]);
  assert.equal(result.efforts.length, 4);
  assert.equal(result.efforts.every((item) => item.ok && item.canary && item.hasResponseId), true);
  assert.equal(result.score.total, 100);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(result).includes("RELAY-CANARY-OK"), false);
});

test("relay audit can select the first model when the model is blank", async () => {
  const result = await auditRelay({
    baseUrl: "https://relay.example/v1",
    apiKey: "synthetic-secret",
    model: "",
  }, { fetcher: fakeFetcher, timeoutMs: 1000 });
  assert.equal(result.model, "gpt-6-test");
  assert.equal(result.modelListed, true);
});

test("ranking payload strips credentials, response text, and unsafe homepage URLs", () => {
  const payload = sanitizeAuditForRanking({
    baseHost: "relay.example",
    model: "gpt-6-test",
    httpStatus: 200,
    modelsCount: 1,
    modelListed: true,
    efforts: [{ effort: "low", status: 200, elapsedMs: 123, ok: true, canary: true, usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, secret: "do-not-send", output: "do-not-send" }],
    score: { total: 100 },
  }, { providerName: "Relay", homepage: "https://relay.example/" });
  assert.equal(payload.homepage, "https://relay.example/");
  assert.equal(Object.hasOwn(payload, "api_key"), false);
  assert.equal(JSON.stringify(payload).includes("do-not-send"), false);
  assert.equal(JSON.stringify(payload).includes("synthetic"), false);
});

test("ranking homepage must belong to the tested API host", () => {
  assert.equal(homepageMatchesBaseHost("https://www.relay.example/", "api.relay.example"), true);
  assert.equal(homepageMatchesBaseHost("https://phishing.example/", "api.relay.example"), false);
});
