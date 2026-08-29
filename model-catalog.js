const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/;
const MAX_MODELS = 512;
const MAX_TEXT = 320;
const CURRENT_REQUEST_BOUNDARY = "Follow the latest user message; treat older summaries as background and resume older work only when explicitly asked.";

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return (result || fallback).slice(0, MAX_TEXT);
}

function modelId(value) {
  const id = String(value ?? "").trim();
  return MODEL_ID_PATTERN.test(id) ? id.slice(0, 160) : "";
}

function reasoningLevels(item, id) {
  const supplied = Array.isArray(item?.supported_reasoning_levels)
    ? item.supported_reasoning_levels
      .map((level) => ({ effort: String(level?.effort || "").trim(), description: text(level?.description) }))
      .filter((level) => ["minimal", "low", "medium", "high", "xhigh"].includes(level.effort) && level.description)
    : [];
  if (supplied.length) return supplied;
  const reasoningModel = /(?:reason|thinking|think|r1|o1|o3|o4|gpt-5|qwq|deepseek-reasoner)/i.test(id);
  const efforts = reasoningModel ? ["low", "medium", "high", "xhigh"] : ["low", "medium"];
  return efforts.map((effort) => ({
    effort,
    description: effort === "low" ? "Fast responses with lighter reasoning" : effort === "medium" ? "Balances speed and reasoning depth" : effort === "high" ? "Greater reasoning depth for complex tasks" : "Maximum reasoning depth when supported",
  }));
}

function numeric(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

const MAX_CONTEXT_WINDOW = 8_000_000;

function providerIdentity(id) {
  const value = String(id || "").toLowerCase();
  const table = [
    [/gemini|palm|bard|gemma/, "Gemini"],
    [/deepseek|deep-seek/, "DeepSeek"],
    [/claude|anthropic/, "Claude"],
    [/qwen|通义|tongyi/, "Qwen"],
    [/glm|zhipu|chatglm|智谱/, "GLM"],
    [/ernie|文心|baidu/, "Ernie"],
    [/doubao|豆包|volcengine|火山/, "Doubao"],
    [/moonshot|kimi/, "Kimi"],
    [/mistral|mixtral/, "Mistral"],
    [/llama|meta/, "Meta Llama"],
    [/grok|xai|x-ai/, "xAI Grok"],
    [/command-r|cohere/, "Command"],
    [/gpt|o1|o3|o4|chatgpt|openai/, "OpenAI"],
  ];
  for (const [pattern, label] of table) if (pattern.test(value)) return label;
  return "";
}

export function isGptModelId(id) {
  return /(?:^|[/:_-])(gpt|o1|o3|o4|codex|chatgpt)(?:$|[.\-_:/@+])/i.test(String(id || "").trim());
}

export function catalogIsMultiModel(entries, fallbackModel = "") {
  const ids = catalogEntryIds(entries);
  const candidateIds = [fallbackModel, ...ids].filter(Boolean);
  return candidateIds.some(isGptModelId);
}

function providerLabel(id, providerName) {
  const known = providerIdentity(id);
  if (known) return known;
  return String(providerName || "").trim() || "API";
}

function inferredInputModalities(id) {
  const value = String(id || "").toLowerCase();
  // Codex's GPT-4o/GPT-5/o-series and the mainstream vision families accept
  // image parts even when a relay omits optional modality metadata from /models.
  if (/(?:gpt|o[1-9]|codex|chatgpt|gemini|claude|sonnet|opus|haiku|qwen(?:2|3)?[-/:_.]?vl|glm[-/:_.]?4v|chatglm[-/:_.]?4v|kimi[-/:_.]?vl|moonshot[-/:_.]?vl|pixtral|mistral[-/:_.]?pixtral|llava|vision|vlm|multimodal)/i.test(value)) {
    return ["text", "image"];
  }
  return ["text"];
}

const GPT_FAMILY_PATTERN = /(?:^|[\/:_@+.-])(?:gpt|o[1-9]|o[1-9]-mini|chatgpt|openai|gpt-[345]|gpt-5)(?:[\/:_@+.-]|$)/i;

export function isGptFamily(ids) {
  const values = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "").trim()).filter(Boolean);
  if (!values.length) return false;
  const joined = values.map((id) => id.toLowerCase()).join(" ");
  if (/gpt|openai|chatgpt|\bo[1-9]\b|\bo[1-9]-mini\b|\bo[1-9]-preview\b/.test(joined)) return true;
  return values.some((id) => GPT_FAMILY_PATTERN.test(id));
}

function normalizeEntry(item, providerName = "Codex Galaxy") {
  const rawId = typeof item === "string" ? item : item?.id || item?.slug || item?.model || item?.sourceId;
  const id = modelId(rawId);
  if (!id) return null;
  const source = typeof item === "object" && item ? item : {};
  const displayName = text(source.display_name || source.name || id, id);
  const description = text(source.description || `${displayName} provided by ${providerName}`, `${displayName} provided by ${providerName}`);
  const levels = reasoningLevels(source, id);
  const defaultReasoning = levels.some((level) => level.effort === source.default_reasoning_level)
    ? source.default_reasoning_level
    : levels.find((level) => level.effort === "medium")?.effort || levels[0].effort;
  const suppliedModalities = source.input_modalities ?? source.inputModalities ?? source.modalities;
  let modalities = Array.isArray(suppliedModalities)
    ? suppliedModalities.map((value) => String(value).toLowerCase()).filter((value) => ["text", "image", "audio"].includes(value)).slice(0, 8)
    : inferredInputModalities(id);
  // Some GPT relays return the incomplete default ["text"] even though the
  // selected GPT model accepts images. Unless the provider explicitly marks it
  // text-only, keep the known GPT multimodal capability visible to Codex.
  if (isGptModelId(id) && modalities.length === 1 && modalities[0] === "text" && source.supports_image_input !== false) modalities = ["text", "image"];
  return {
    sourceId: id,
    display_name: displayName,
    description,
    default_reasoning_level: defaultReasoning,
    supported_reasoning_levels: levels,
    context_window: numeric(source.context_window, 128000, 1024, MAX_CONTEXT_WINDOW),
    max_context_window: numeric(source.max_context_window, numeric(source.context_window, 128000, 1024, MAX_CONTEXT_WINDOW), 1024, MAX_CONTEXT_WINDOW),
    input_modalities: modalities.length ? modalities : ["text"],
    supports_parallel_tool_calls: source.supports_parallel_tool_calls !== false,
    supports_reasoning_summaries: Boolean(source.supports_reasoning_summaries),
    supports_image_detail_original: Boolean(source.supports_image_detail_original),
  };
}

export function catalogEntries(payload, providerName = "Codex Galaxy") {
  const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  const seen = new Set();
  const result = [];
  for (const item of entries) {
    const normalized = normalizeEntry(item, providerName);
    if (!normalized || seen.has(normalized.sourceId)) continue;
    seen.add(normalized.sourceId);
    result.push(normalized);
    if (result.length >= MAX_MODELS) break;
  }
  return result;
}

export function catalogEntryIds(entries) {
  return [...new Set((Array.isArray(entries) ? entries : []).map((entry) => modelId(typeof entry === "string" ? entry : entry?.sourceId || entry?.slug || entry?.id || entry?.model)).filter(Boolean))].slice(0, MAX_MODELS);
}

export function buildModelCatalog(entries, { providerName = "Codex Galaxy", providerKind = "API", singleModel = false } = {}) {
  const normalizedEntries = catalogEntries({ models: entries }, providerName);
  const normalized = singleModel ? normalizedEntries.slice(0, 1) : normalizedEntries;
  return {
    models: normalized.map((entry, index) => ({
      slug: entry.sourceId,
      display_name: entry.display_name,
      description: entry.description,
      default_reasoning_level: entry.default_reasoning_level,
      supported_reasoning_levels: entry.supported_reasoning_levels,
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: index,
      additional_speed_tiers: [],
      service_tiers: [],
      availability_nux: { message: "" },
      upgrade: null,
      base_instructions: `You are Codex Galaxy, powered by ${entry.display_name} (${entry.sourceId}) via ${providerLabel(entry.sourceId, providerName)}. Work with the user in the shared workspace. ${CURRENT_REQUEST_BOUNDARY} Use ${entry.display_name} faithfully; current provider: ${providerKind}.`,
      model_messages: {
        // The base instructions are already applied by Codex. Repeating them
        // here makes every turn carry a second copy into the context window.
        instructions_template: "{{ personality }}",
      },
      supports_reasoning_summaries: entry.supports_reasoning_summaries,
      default_reasoning_summary: "none",
      support_verbosity: true,
      default_verbosity: "low",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text_and_image",
      truncation_policy: { mode: "tokens", limit: 10000 },
      supports_parallel_tool_calls: entry.supports_parallel_tool_calls,
      supports_image_detail_original: entry.supports_image_detail_original,
      context_window: entry.context_window,
      max_context_window: entry.max_context_window,
      effective_context_window_percent: 95,
      experimental_supported_tools: [],
      input_modalities: entry.input_modalities,
      supports_search_tool: true,
    })),
  };
}

export function catalogModelIds(catalog) {
  return catalogEntryIds(catalog?.models || catalog);
}


export function buildSingleModelCatalog(model, { providerName = "Codex Galaxy", providerKind = "API", platformLabel = "" } = {}) {
  const source = typeof model === "object" && model ? model : { id: model };
  const id = modelId(source.id || source.slug || source.model || source.sourceId);
  if (!id) throw new Error("固定模型 ID 无效。");
  const platform = providerLabel(id, platformLabel || providerName);
  return buildModelCatalog([{ ...source, id }], { providerName: platform, providerKind, singleModel: true });
}

export { MODEL_ID_PATTERN, MAX_MODELS };
