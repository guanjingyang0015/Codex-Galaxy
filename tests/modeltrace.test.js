import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeGptModelTrace,
  generateModelTraceChallenges,
  isGptModel,
  modelTraceBank,
} from "../modeltrace.js";

test("ModelTrace integration bundles only GPT candidates and generates hidden probes", () => {
  const bank = modelTraceBank();
  assert.equal(bank.models.length, 6);
  assert.equal(bank.models.every((model) => /^gpt-/i.test(model.id)), true);
  assert.equal(isGptModel("provider/gpt-5.6-sol"), true);
  assert.equal(isGptModel("claude-opus-5"), false);

  const challenges = generateModelTraceChallenges(3);
  assert.equal(challenges.length, 3);
  assert.equal(new Set(challenges.map((item) => item.expectedCount)).size, 3);
  assert.equal(challenges.every((item) => item.expectedCount >= 292 && item.expectedCount <= 332), true);
  assert.equal(challenges.every((item) => item.prompt.includes("禁止调用或借助任何工具")), true);
});

test("ModelTrace integration returns a bounded GPT-only aggregate without raw outputs", () => {
  const sequence = Array.from({ length: 320 }, (_, index) => ((index * 37) % 355) + 1).join(", ");
  const result = analyzeGptModelTrace([
    { text: sequence, expected_count: 320 },
    { text: sequence, expected_count: 320 },
    { text: sequence, expected_count: 320 },
  ]);
  assert.match(result.prediction, /^gpt-/i);
  assert.equal(result.used_outputs, 3);
  assert.equal(result.probability >= 0 && result.probability <= 1, true);
  assert.equal(JSON.stringify(result).includes(sequence), false);
});
