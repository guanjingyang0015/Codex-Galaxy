import { modelsUrl } from "./responses-gateway.js";
import { profileForSwitch, recordProfileTest } from "./profiles.js";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const EFFORTS = ["low", "medium", "high", "xhigh"];

function classifyHttp(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 404 || status === 405) return "not-found";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 500) return "server";
  return "unsupported";
}

function safeNetworkReason(error) {
  const detail = [error?.code, error?.cause?.code, error?.name, error?.message, error?.cause?.message]
    .filter(Boolean).join(" ").toLowerCase();
  if (/enotfound|eai_again|name_not_resolved|dns/.test(detail)) return "域名解析失败（DNS）";
  if (/cert|certificate|tls|ssl/.test(detail)) return "TLS/证书连接失败";
  if (/timed?out|etimedout|abort/.test(detail)) return "连接超时";
  if (/proxy|tunnel|407/.test(detail)) return "系统代理无法连接";
  if (/econnrefused|connection_refused/.test(detail)) return "连接被目标地址拒绝";
  return "网络连接失败";
}

function safeError(error) {
  return String(error?.message || error || "")
    .replace(/Bearer\s+\S+/ig, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .slice(0, 220);
}

function validBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function modelId(entry) {
  return String(entry?.id || entry?.slug || entry?.model || "").trim();
}

function usesReasoningEfforts(model) {
  return /^(?:gpt|o\d)/i.test(normalizedModel(model));
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function readLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (typeof response?.text === "function" && !response.body?.getReader) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: Buffer.byteLength(text) > maxBytes };
  }
  const reader = response?.body?.getReader?.();
  if (!reader) return { text: "", truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value || "");
      if (total < maxBytes) {
        const allowed = chunk.subarray(0, maxBytes - total);
        chunks.push(allowed);
        total += allowed.length;
      }
      if (total >= maxBytes && chunk.length > maxBytes - total) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function findJsonObjects(text) {
  const values = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const candidate = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!candidate || candidate === "[DONE]") continue;
    const parsed = parseJson(candidate);
    if (parsed) values.push(parsed);
  }
  return values;
}

function outputContainsCanary(text, payload) {
  if (String(text || "").includes("RELAY-CANARY-OK")) return true;
  return JSON.stringify(payload || "").includes("RELAY-CANARY-OK");
}

function usageOf(payloads) {
  for (const payload of payloads) {
    const usage = payload?.usage || payload?.response?.usage;
    if (usage && typeof usage === "object") {
      return {
        input_tokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
        output_tokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
        total_tokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
      };
    }
  }
  return null;
}

function messageOf(payloads) {
  for (const payload of payloads) {
    const error = payload?.error;
    if (error) {
      return {
        type: String(error.type || ""),
        code: String(error.code || ""),
        message: safeError(error.message),
      };
    }
  }
  return null;
}

function normalizedModel(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("/") ? text.split("/").at(-1) : text;
}

function modelRelation(expected, actual) {
  const left = normalizedModel(expected);
  const right = normalizedModel(actual);
  if (!left || !right) return "unknown";
  if (left === right) return "exact";
  const separator = /[-_.:@]/;
  if ((right.startsWith(left) && separator.test(right[left.length] || ""))
    || (left.startsWith(right) && separator.test(left[right.length] || ""))) return "compatible";
  const leftGpt = left.match(/^gpt[-_.]?(\d+(?:\.\d+)?)(?:$|[-_.:@])/);
  const rightGpt = right.match(/^gpt[-_.]?(\d+(?:\.\d+)?)(?:$|[-_.:@])/);
  if (leftGpt && rightGpt && leftGpt[1] === rightGpt[1]) return "compatible";
  return "mismatch";
}

function observedModelsOf(payloads) {
  const values = [];
  for (const payload of payloads) {
    for (const candidate of [payload?.model, payload?.response?.model, payload?.data?.model]) {
      const value = String(candidate || "").trim();
      if (value && !values.some((item) => item.toLowerCase() === value.toLowerCase())) values.push(value.slice(0, 160));
    }
  }
  return values;
}

function performanceScore(results) {
  const successful = results.filter((item) => item.ok && item.canary && Number.isFinite(item.elapsedMs));
  if (!successful.length) return 0;
  const average = successful.reduce((sum, item) => sum + item.elapsedMs, 0) / successful.length;
  if (average <= 3000) return 10;
  if (average <= 6000) return 8;
  if (average <= 10_000) return 6;
  if (average <= 15_000) return 3;
  return 1;
}

function modelVerdictFor(expectedModel, requestedModel, modelIds, observedModels) {
  const expected = String(expectedModel || "").trim();
  const evidenceModels = observedModels.length ? observedModels : modelIds.slice(0, 8);
  const requested = String(requestedModel || "").trim();
  const listedRelations = expected ? modelIds.map((item) => modelRelation(expected, item)) : [];
  const observedRelations = expected ? evidenceModels.map((item) => modelRelation(expected, item)) : [];
  const listed = listedRelations.some((item) => item === "exact" || item === "compatible");
  const observedExact = observedRelations.length > 0 && observedRelations.every((item) => item === "exact");
  const observedCompatible = observedRelations.length > 0 && observedRelations.every((item) => item === "exact" || item === "compatible");
  let verdict = "unverified";
  let score = 0;
  if (!expected) {
    verdict = "unspecified";
    score = 20;
  } else if (observedRelations.some((item) => item === "mismatch")) {
    verdict = "mismatch";
  } else if (observedExact) {
    verdict = "exact";
    score = listed ? 40 : 30;
  } else if (observedCompatible) {
    verdict = "compatible";
    score = listed ? 34 : 26;
  } else if (listed) {
    verdict = "listed-only";
    score = 24;
  } else if (expected && modelIds.length) {
    verdict = "mismatch";
  }
  return {
    expectedModel: expected || null,
    requestedModel: requested || null,
    listed,
    observedModels: evidenceModels,
    observedModel: evidenceModels[0] || null,
    verdict,
    score,
    matchesDesired: verdict === "exact" || verdict === "compatible" ? true : verdict === "mismatch" ? false : null,
  };
}

function buildScore({ modelsResponse, modelVerdict, results }) {
  const total = Math.max(1, results.length);
  const httpSuccess = results.filter((item) => item.ok).length;
  const canarySuccess = results.filter((item) => item.ok && item.canary).length;
  const responseIds = results.filter((item) => item.hasResponseId).length;
  const usageResults = results.filter((item) => item.usage).length;
  const timeouts = results.filter((item) => item.status === 0 && item.error?.type === "AbortError").length;
  const catalog = modelsResponse.status >= 200 && modelsResponse.status < 300 ? 10 : 0;
  const responses = (httpSuccess ? 8 : 0) + Math.round((responseIds / total) * 4) + Math.round((usageResults / total) * 3);
  const reasoning = Math.round((canarySuccess / total) * 15);
  const stability = Math.max(0, Math.round((httpSuccess / total) * 10) - Math.min(3, timeouts));
  const performance = performanceScore(results);
  const beforeCap = catalog + modelVerdict.score + responses + reasoning + stability + performance;
  const cap = modelVerdict.verdict === "mismatch"
    ? 49
    : modelVerdict.verdict === "unverified"
      ? 59
      : modelVerdict.verdict === "listed-only"
        ? 79
      : modelVerdict.verdict === "unspecified"
        ? 80
        : 100;
  return {
    total: Math.max(0, Math.min(cap, beforeCap)),
    catalog,
    protocol: catalog + responses,
    responses,
    model: modelVerdict.score,
    effort: reasoning,
    reasoning,
    stability,
    speed: performance,
    performance,
    cap,
  };
}

function checksFor({ modelsResponse, modelVerdict, results, score }) {
  const total = Math.max(1, results.length);
  const httpSuccess = results.filter((item) => item.ok).length;
  const canarySuccess = results.filter((item) => item.ok && item.canary).length;
  const responseIds = results.filter((item) => item.hasResponseId).length;
  const usageResults = results.filter((item) => item.usage).length;
  const timeouts = results.filter((item) => item.status === 0 && item.error?.type === "AbortError").length;
  const elapsed = results.filter((item) => item.ok && item.canary).map((item) => item.elapsedMs);
  const averageMs = elapsed.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : null;
  return [
    { key: "catalog", status: score.catalog === 10 ? "pass" : "fail", score: score.catalog, maxScore: 10, httpStatus: modelsResponse.status || 0, modelsCount: modelsResponse.entries.length },
    { key: "model", status: modelVerdict.matchesDesired === true ? "pass" : modelVerdict.matchesDesired === false ? "fail" : "warn", score: score.model, maxScore: 40, ...modelVerdict },
    { key: "responses", status: httpSuccess === total && responseIds === total && usageResults === total ? "pass" : httpSuccess ? "warn" : "fail", score: score.responses, maxScore: 15, successCount: httpSuccess, responseIdCount: responseIds, usageCount: usageResults, total },
    { key: "reasoning", status: canarySuccess === total ? "pass" : canarySuccess ? "warn" : "fail", score: score.reasoning, maxScore: 15, successCount: canarySuccess, total },
    { key: "stability", status: httpSuccess === total ? "pass" : httpSuccess ? "warn" : "fail", score: score.stability, maxScore: 10, successCount: httpSuccess, timeoutCount: timeouts, total },
    { key: "performance", status: score.performance >= 8 ? "pass" : score.performance > 0 ? "warn" : "fail", score: score.performance, maxScore: 10, averageMs },
  ];
}

function assessmentFor({ modelVerdict, score, results }) {
  const allCanaries = results.length > 0 && results.every((item) => item.ok && item.canary);
  if ((modelVerdict.verdict === "exact" || modelVerdict.verdict === "compatible") && score.total >= 85 && allCanaries) return "conforming";
  if (modelVerdict.verdict === "mismatch" || score.total < 50) return "suspicious";
  return "inconclusive";
}

function findingsFor({ modelsResponse, modelVerdict, results, score, probeMode }) {
  const findings = [];
  if (modelsResponse.status !== 200) findings.push(`模型列表返回 HTTP ${modelsResponse.status || "网络错误"}`);
  if (modelVerdict.verdict === "exact") findings.push(`响应声明的模型与期望模型一致：${modelVerdict.observedModel}`);
  if (modelVerdict.verdict === "compatible") findings.push(`响应模型与期望型号属于同一系列：${modelVerdict.expectedModel} → ${modelVerdict.observedModel}`);
  if (modelVerdict.verdict === "listed-only") findings.push(`期望模型出现在 /models 中，但响应没有返回可核对的 model 字段：${modelVerdict.expectedModel}`);
  if (modelVerdict.verdict === "mismatch") findings.push(`模型不匹配：期望 ${modelVerdict.expectedModel}，响应声明 ${modelVerdict.observedModels.join("、") || "未知"}`);
  if (modelVerdict.verdict === "unverified") findings.push(`无法验证期望模型：${modelVerdict.expectedModel || "未设置"}`);
  if (modelVerdict.verdict === "unspecified") findings.push("账号未设置期望模型，因此只能检测可用性，不能判断是否为用户想要的型号");
  if (probeMode === "reasoning" && !modelsResponse.declaredReasoningLevels.length) findings.push("模型列表没有声明推理强度，强度支持只能通过行为测试观察");
  if (probeMode === "repeat") findings.push("该模型不使用 GPT 推理强度评分，已改用 3 次确定性 Responses 一致性测试");
  const failed = results.filter((item) => !item.ok || !item.canary);
  if (failed.length) findings.push(`未通过的能力测试：${failed.map((item) => item.effort).join("、")}`);
  if (results.some((item) => item.status === 0 && item.error?.type === "AbortError")) findings.push("至少一个能力测试请求超时");
  if (score.cap < 100) findings.push(`模型核对结论触发总分上限：${score.cap} 分`);
  findings.push("黑盒测试只能验证接口声明与行为一致性，不能证明中转站一定连接官方上游");
  return findings;
}

async function fetchWithTimeout(fetcher, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeModels(baseUrl, apiKey, selectedModel, fetcher, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, modelsUrl(baseUrl).toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    }, timeoutMs);
    const body = await readLimited(response);
    const payload = parseJson(body.text);
    const entries = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];
    const selected = selectedModel
      ? entries.find((entry) => modelRelation(selectedModel, modelId(entry)) === "exact")
        || entries.find((entry) => modelRelation(selectedModel, modelId(entry)) === "compatible")
      : entries[0] || null;
    return {
      status: response.status,
      elapsedMs: Date.now() - started,
      entries,
      selected,
      declaredReasoningLevels: Array.isArray(selected?.supported_reasoning_levels)
        ? selected.supported_reasoning_levels.map((item) => String(item?.effort || "").trim()).filter(Boolean).slice(0, 8)
        : [],
      contextWindow: selected?.context_window ?? selected?.contextWindow ?? null,
      error: messageOf([payload]),
    };
  } catch (error) {
    return {
      status: 0,
      elapsedMs: Date.now() - started,
      entries: [],
      selected: null,
      declaredReasoningLevels: [],
      contextWindow: null,
      error: { type: error?.name || "fetch_error", code: error?.code || "", message: safeError(error) },
    };
  }
}

async function probeEffort(baseUrl, apiKey, model, effort, fetcher, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, new URL("responses", `${baseUrl.toString().replace(/\/+$/, "")}/`).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        model,
        input: "Return exactly RELAY-CANARY-OK and nothing else.",
        ...(EFFORTS.includes(effort) ? { reasoning: { effort } } : {}),
        max_output_tokens: 48,
        store: false,
      }),
    }, timeoutMs);
    const body = await readLimited(response);
    const payloads = [
      parseJson(body.text),
      ...findJsonObjects(body.text),
    ].filter(Boolean);
    return {
      effort,
      status: response.status,
      elapsedMs: Date.now() - started,
      ok: response.status >= 200 && response.status < 300,
      canary: outputContainsCanary(body.text, payloads),
      hasResponseId: payloads.some((payload) => [payload?.id, payload?.response?.id].some((value) => typeof value === "string" && value.length > 0)),
      observedModels: observedModelsOf(payloads),
      usage: usageOf(payloads),
      error: messageOf(payloads),
    };
  } catch (error) {
    return {
      effort,
      status: 0,
      elapsedMs: Date.now() - started,
      ok: false,
      canary: false,
      hasResponseId: false,
      observedModels: [],
      usage: null,
      error: { type: error?.name || "fetch_error", code: error?.code || "", message: safeError(error) },
    };
  }
}

export async function auditRelay(input, {
  fetcher = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  efforts = EFFORTS,
  onProgress = () => {},
} = {}) {
  const baseUrl = validBaseUrl(input?.baseUrl);
  const apiKey = String(input?.apiKey || "").trim();
  const selectedModel = String(input?.model || "").trim();
  const expectedModel = String(input?.expectedModel ?? input?.model ?? "").trim();
  const testedAt = new Date().toISOString();
  if (!baseUrl) return { status: "invalid", testedAt, reason: "Base URL 格式不正确", findings: ["Base URL 格式不正确"] };
  if (!apiKey) return { status: "auth", testedAt, reason: "API Key 不能为空", findings: ["API Key 不能为空"] };
  let steps = efforts.filter((item) => EFFORTS.includes(item));
  let total = steps.length + 1;
  let estimateMs = Math.max(1000, total * Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const startedAt = Date.now();
  const report = (completed, stage, message) => {
    const elapsedMs = Date.now() - startedAt;
    const projectedTotalMs = completed > 0
      ? Math.min(estimateMs, Math.max(elapsedMs + 1000, Math.round((elapsedMs / completed) * total)))
      : estimateMs;
    onProgress({
      percent: Math.max(0, Math.min(100, Math.round((completed / total) * 100))),
      stage,
      message,
      completed,
      total,
      elapsedMs,
      estimatedTotalMs: projectedTotalMs,
      estimatedRemainingMs: Math.max(0, projectedTotalMs - elapsedMs),
    });
  };
  report(0, "models", "正在读取模型列表");
  const modelsResponse = await probeModels(baseUrl, apiKey, selectedModel, fetcher, timeoutMs);
  report(1, "models", "模型列表读取完成");
  const modelsOk = modelsResponse.status >= 200 && modelsResponse.status < 300;
  const effectiveModel = selectedModel || modelId(modelsResponse.entries[0]);
  const selectedFound = Boolean(modelsResponse.selected && effectiveModel);
  if (!effectiveModel) return {
    status: modelsOk ? "unsupported" : "network",
    testedAt,
    reason: modelsOk ? "中转站没有返回可用模型" : modelsResponse.error?.message || "模型列表读取失败",
    findings: ["没有找到可用于测试的模型"],
  };
  const probeMode = usesReasoningEfforts(effectiveModel) ? "reasoning" : "repeat";
  if (probeMode === "repeat") {
    steps = ["repeat-1", "repeat-2", "repeat-3"];
    total = steps.length + 1;
    estimateMs = Math.max(1000, total * Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  }
  const results = [];
  for (const [index, effort] of steps.entries()) {
    report(index + 1, effort, probeMode === "reasoning" ? `正在测试 ${effort} 推理强度` : `正在进行第 ${index + 1} 次一致性测试`);
    results.push(await probeEffort(baseUrl, apiKey, effectiveModel, effort, fetcher, timeoutMs));
    report(index + 2, effort, probeMode === "reasoning" ? `${effort} 推理强度测试完成` : `第 ${index + 1} 次一致性测试完成`);
  }
  const successful = results.filter((item) => item.ok && item.canary);
  const modelIds = modelsResponse.entries.map(modelId).filter(Boolean);
  const observedModels = [...new Set(results.flatMap((item) => item.observedModels || []))];
  const modelVerdict = modelVerdictFor(expectedModel, effectiveModel, modelIds, observedModels);
  const status = modelsResponse.status === 401 || modelsResponse.status === 403
    ? "auth"
    : modelsOk || successful.length
      ? "ok"
      : modelsResponse.status >= 500
        ? "server"
        : "network";
  const score = buildScore({ modelsResponse, modelVerdict, results });
  const checks = checksFor({ modelsResponse, modelVerdict, results, score });
  const result = {
    status,
    testedAt,
    httpStatus: modelsResponse.status || null,
    baseHost: baseUrl.host,
    model: effectiveModel,
    requestedModel: effectiveModel,
    expectedModel: expectedModel || null,
    observedModel: modelVerdict.observedModel,
    observedModels: modelVerdict.observedModels,
    modelVerdict: modelVerdict.verdict,
    matchesDesiredModel: modelVerdict.matchesDesired,
    expectedModelListed: modelVerdict.listed,
    probeMode,
    modelsCount: modelsResponse.entries.length,
    modelIds: modelIds.slice(0, 50),
    modelListed: selectedFound,
    declaredReasoningLevels: modelsResponse.declaredReasoningLevels,
    contextWindow: modelsResponse.contextWindow,
    efforts: results.map(({ effort: name, status: responseStatus, elapsedMs, ok, canary, hasResponseId, observedModels: effortModels, usage, error }) => ({
      effort: name,
      status: responseStatus,
      elapsedMs,
      ok,
      canary,
      hasResponseId,
      observedModels: effortModels,
      usage,
      error,
    })),
    score,
    checks,
    assessment: assessmentFor({ modelVerdict, score, results }),
    findings: findingsFor({ modelsResponse, modelVerdict, results, score, probeMode }),
    message: modelsOk
      ? `已完成 ${results.length} 个能力测试，综合分 ${score.total}/100`
      : modelsResponse.error?.message || "中转站测试未完成",
  };
  report(total, "complete", "API 检测完成");
  return result;
}

export async function auditApiProfile(id, paths, options = {}) {
  const profile = await profileForSwitch(id, paths);
  if (profile.kind !== "api") throw new Error("只有中转 API 配置可以测试。");
  if (!profile.apiKey) throw new Error("这个 API 账号没有保存 Key，请先编辑账号并填写 Key。");
  const result = await auditRelay({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.resolvedModel || profile.model,
    expectedModel: profile.model,
  }, options);
  if (options.persist !== false) await recordProfileTest(id, result, paths);
  return { ...result, profile: { id: profile.id, name: profile.name, homepage: profile.homepage || null } };
}

export { DEFAULT_TIMEOUT_MS, EFFORTS, classifyHttp, safeNetworkReason };
