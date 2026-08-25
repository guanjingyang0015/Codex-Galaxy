import test from "node:test";
import assert from "node:assert/strict";
import { buildModelCatalog, buildSingleModelCatalog, catalogEntries, catalogModelIds } from "../model-catalog.js";

test("model catalog supports mainstream and arbitrary vendor model ids", () => {
  const catalog = buildModelCatalog([
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context_window: 1048576 },
    { id: "deepseek-reasoner" },
    { id: "claude-sonnet-4-20250514" },
    { id: "qwen/qwen3-235b-a22b" },
    { id: "vendor/custom-model:premium" },
  ], { providerName: "Octopus Relay" });

  assert.deepEqual(catalogModelIds(catalog), [
    "gemini-2.5-flash",
    "deepseek-reasoner",
    "claude-sonnet-4-20250514",
    "qwen/qwen3-235b-a22b",
    "vendor/custom-model:premium",
  ]);
  assert.equal(catalog.models[0].context_window, 1048576);
  assert.match(catalog.models[0].base_instructions, /Gemini 2\.5 Flash/);
  assert.doesNotMatch(catalog.models[0].base_instructions, /GPT-5/);
  assert.equal(catalog.models[0].model_messages.instructions_template.includes("{{ personality }}"), true);
  assert.match(catalog.models[0].base_instructions, /latest user message defines the current request/);
  assert.match(catalog.models[0].model_messages.instructions_template, /do not resume older pending work/);
  assert.match(catalog.models[0].model_messages.instructions_template, /Do not call tools or modify files for a simple question/);
  assert.equal(catalog.models[4].slug, "vendor/custom-model:premium");
});

test("model catalog sanitizes malformed entries and accepts standard /models payloads", () => {
  const entries = catalogEntries({ data: [
    { id: "", name: "bad" },
    { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", supported_reasoning_levels: [{ effort: "high", description: "Deep" }] },
    "deepseek-v3.2",
    { id: "gemini-2.5-pro" },
  ] }, "Gemini");
  assert.deepEqual(entries.map((entry) => entry.sourceId), ["gemini-2.5-pro", "deepseek-v3.2"]);
  assert.deepEqual(entries[0].supported_reasoning_levels, [{ effort: "high", description: "Deep" }]);
});

test("single-model catalogs preserve the real upstream name, version, and metadata", () => {
  const catalog = buildSingleModelCatalog({
    sourceId: "gemini-2.5-flash",
    display_name: "Gemini 2.5 Flash",
    description: "Google's low-latency Gemini model",
    context_window: 1048576,
    input_modalities: ["text", "image"],
  }, { providerName: "Gemini relay" });

  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].slug, "gemini-2.5-flash");
  assert.equal(catalog.models[0].display_name, "Gemini 2.5 Flash");
  assert.equal(catalog.models[0].description, "Google's low-latency Gemini model");
  assert.equal(catalog.models[0].context_window, 1048576);
  assert.deepEqual(catalog.models[0].input_modalities, ["text", "image"]);

  const idFallback = buildSingleModelCatalog("deepseek-v3.2");
  assert.equal(idFallback.models[0].display_name, "deepseek-v3.2");
});

test("known multimodal models infer image input when a relay omits modality metadata", () => {
  const catalog = buildSingleModelCatalog({ id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" });
  assert.deepEqual(catalog.models[0].input_modalities, ["text", "image"]);
  const textOnly = buildSingleModelCatalog({ id: "deepseek-reasoner", input_modalities: ["text"] });
  assert.deepEqual(textOnly.models[0].input_modalities, ["text"]);
  const incompleteRelay = buildSingleModelCatalog({ id: "gpt-5.6-sol", input_modalities: ["text"] });
  assert.deepEqual(incompleteRelay.models[0].input_modalities, ["text", "image"]);
  const explicitlyTextOnly = buildSingleModelCatalog({ id: "gpt-custom-text", input_modalities: ["text"], supports_image_input: false });
  assert.deepEqual(explicitlyTextOnly.models[0].input_modalities, ["text"]);
});
