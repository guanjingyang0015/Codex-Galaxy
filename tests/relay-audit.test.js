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
    model: "gpt-6-test",
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
  assert.equal(result.basePath, "/v1");
  assert.equal(result.model, "gpt-6-test");
  assert.equal(result.modelsCount, 1);
  assert.equal(result.modelListed, true);
  assert.equal(result.modelVerdict, "exact");
  assert.equal(result.matchesDesiredModel, true);
  assert.equal(result.observedModel, "gpt-6-test");
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

test("relay audit hard-caps a different response-declared model below 50", async () => {
  const result = await auditRelay({
    baseUrl: "https://relay.example/v1",
    apiKey: "synthetic-secret",
    model: "gpt-6",
  }, {
    timeoutMs: 1000,
    fetcher: async (url, options) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-6" }] }), { status: 200 });
      }
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: `msg-${body.reasoning.effort}`,
        model: "gpt-5.6-sol",
        output_text: "RELAY-CANARY-OK",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }), { status: 200 });
    },
  });
  assert.equal(result.modelVerdict, "mismatch");
  assert.equal(result.matchesDesiredModel, false);
  assert.equal(result.observedModel, "gpt-5.6-sol");
  assert.equal(result.score.total, 49);
  assert.equal(result.assessment, "suspicious");
});

test("non-GPT models use repeatable Responses probes without GPT reasoning fields", async () => {
  const bodies = [];
  const result = await auditRelay({
    baseUrl: "https://relay.example/v1",
    apiKey: "synthetic-secret",
    model: "deepseek-reasoner",
  }, {
    timeoutMs: 1000,
    fetcher: async (url, options) => {
      if (url.endsWith("/models")) return new Response(JSON.stringify({
        data: [{ id: "deepseek-reasoner", supported_reasoning_levels: [{ effort: "high" }] }],
      }), { status: 200 });
      const body = JSON.parse(options.body);
      bodies.push(body);
      return new Response(JSON.stringify({
        id: "deepseek-response",
        model: "deepseek-reasoner",
        output_text: "RELAY-CANARY-OK",
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      }), { status: 200 });
    },
  });
  assert.equal(result.probeMode, "repeat");
  assert.equal(result.efforts.length, 3);
  assert.equal(bodies.every((body) => !Object.hasOwn(body, "reasoning")), true);
  assert.equal(result.modelVerdict, "exact");
  assert.equal(result.score.total, 100);
});

test("GPT audit runs hidden fingerprint probes and caps a different candidate without retaining raw output", async () => {
  const sequence = Array.from({ length: 320 }, (_, index) => ((index * 37) % 355) + 1).join(", ");
  let fingerprintRequests = 0;
  const result = await auditRelay({
    baseUrl: "https://relay.example/v1",
    apiKey: "synthetic-secret",
    model: "gpt-9-test",
  }, {
    timeoutMs: 1000,
    fetcher: async (url, options) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "gpt-9-test", supported_reasoning_levels: [{ effort: "high", description: "high" }] }],
        }), { status: 200 });
      }
      const body = JSON.parse(options.body);
      if (String(body.input).includes("RELAY-CANARY-OK")) {
        return new Response(JSON.stringify({
          id: `canary-${body.reasoning?.effort || "default"}`,
          model: "gpt-9-test",
          output_text: "RELAY-CANARY-OK",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }), { status: 200 });
      }
      fingerprintRequests += 1;
      return new Response(JSON.stringify({
        id: `fingerprint-${fingerprintRequests}`,
        model: "gpt-9-test",
        output_text: sequence,
        usage: { input_tokens: 1, output_tokens: 320, total_tokens: 321 },
      }), { status: 200 });
    },
  });
  assert.equal(fingerprintRequests, 3);
  assert.equal(result.fingerprint.status, "ok");
  assert.equal(result.fingerprint.usedOutputs, 3);
  assert.match(result.fingerprint.prediction, /^gpt-/i);
  assert.equal(result.fingerprint.fingerprintVerdict, "different-candidate");
  assert.equal(result.score.fingerprint, 0);
  assert.equal(result.score.total, 79);
  assert.equal(result.assessment, "inconclusive");
  assert.equal(JSON.stringify(result).includes(sequence), false);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});

test("ranking payload strips credentials, response text, and unsafe homepage URLs", () => {
  const payload = sanitizeAuditForRanking({
    baseHost: "relay.example",
    model: "gpt-6-test",
    expectedModel: "gpt-6",
    observedModel: "gpt-6-astra",
    observedModels: ["gpt-6-astra"],
    modelVerdict: "compatible",
    matchesDesiredModel: true,
    expectedModelListed: true,
    httpStatus: 200,
    modelsCount: 1,
    modelListed: true,
    efforts: [{ effort: "low", status: 200, elapsedMs: 123, ok: true, canary: true, usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, secret: "do-not-send", output: "do-not-send" }],
    fingerprint: {
      status: "ok",
      prediction: "gpt-5.6-luna",
      probability: 0.997,
      fingerprintVerdict: "different-candidate",
      usedOutputs: 3,
      candidates: [{ model: "gpt-5.6-luna", raw: "do-not-send" }],
    },
    score: { total: 100 },
  }, { providerName: "Relay", homepage: "https://relay.example/" });
  assert.equal(payload.homepage, "https://relay.example/");
  assert.equal(payload.base_path, "/");
  assert.equal(payload.expected_model, "gpt-6");
  assert.equal(payload.observed_model, "gpt-6-astra");
  assert.equal(payload.model_verdict, "compatible");
  assert.equal(payload.expected_model_listed, true);
  assert.deepEqual(payload.fingerprint, {
    status: "ok",
    candidate: "gpt-5.6-luna",
    probability: 0.997,
    verdict: "different-candidate",
    used_outputs: 3,
  });
  assert.equal(Object.hasOwn(payload, "api_key"), false);
  assert.equal(JSON.stringify(payload).includes("do-not-send"), false);
  assert.equal(JSON.stringify(payload).includes("synthetic"), false);
});

test("ranking homepage must belong to the tested API host", () => {
  assert.equal(homepageMatchesBaseHost("https://www.relay.example/", "api.relay.example"), true);
  assert.equal(homepageMatchesBaseHost("https://phishing.example/", "api.relay.example"), false);
});
