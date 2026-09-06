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
    if (payload?.usage && typeof payload.usage === "object") {
      return {
        input_tokens: Number.isFinite(Number(payload.usage.input_tokens)) ? Number(payload.usage.input_tokens) : null,
        output_tokens: Number.isFinite(Number(payload.usage.output_tokens)) ? Number(payload.usage.output_tokens) : null,
        total_tokens: Number.isFinite(Number(payload.usage.total_tokens)) ? Number(payload.usage.total_tokens) : null,
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

function effortScore(results) {
  return Math.round((results.filter((item) => item.ok && item.canary).length / EFFORTS.length) * 25);
}

function speedScore(results) {
  const successful = results.filter((item) => item.ok && item.canary && Number.isFinite(item.elapsedMs));
  if (!successful.length) return 0;
  const average = successful.reduce((sum, item) => sum + item.elapsedMs, 0) / successful.length;
  if (average <= 3000) return 15;
  if (average <= 6000) return 12;
  if (average <= 10_000) return 8;
  if (average <= 15_000) return 4;
  return 1;
}

function assessmentFor({ modelsOk, selectedFound, results }) {
  const successes = results.filter((item) => item.ok && item.canary).length;
  if (modelsOk && selectedFound && successes === EFFORTS.length) return "conforming";
  if (successes || modelsOk) return "inconclusive";
  return "suspicious";
}

function findingsFor({ modelsResponse, selectedFound, results }) {
  const findings = [];
  if (modelsResponse.status !== 200) findings.push(`模型列表返回 HTTP ${modelsResponse.status || "网络错误"}`);
  if (!selectedFound) findings.push("目标模型未出现在 /models 返回列表中");
  if (!modelsResponse.declaredReasoningLevels.length) findings.push("模型列表没有声明推理强度，强度支持只能通过行为测试观察");
  const failed = results.filter((item) => !item.ok || !item.canary);
  if (failed.length) findings.push(`${failed.length} 个推理强度测试未完成或未返回固定校验词`);
  if (results.some((item) => item.status === 0 && item.error?.type === "AbortError")) findings.push("至少一个强度请求超时");
  findings.push("黑盒测试不能证明中转站一定连接官方上游");
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
      ? entries.find((entry) => modelId(entry).toLowerCase() === selectedModel.toLowerCase())
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
        reasoning: { effort },
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
      hasResponseId: payloads.some((payload) => typeof payload?.id === "string" && payload.id.length > 0),
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
  const testedAt = new Date().toISOString();
  if (!baseUrl) return { status: "invalid", testedAt, reason: "Base URL 格式不正确", findings: ["Base URL 格式不正确"] };
  if (!apiKey) return { status: "auth", testedAt, reason: "API Key 不能为空", findings: ["API Key 不能为空"] };
  const steps = efforts.filter((item) => EFFORTS.includes(item));
  const total = steps.length + 1;
  const estimateMs = Math.max(1000, total * Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
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
  const results = [];
  for (const [index, effort] of steps.entries()) {
    report(index + 1, effort, `正在测试 ${effort} 推理强度`);
    results.push(await probeEffort(baseUrl, apiKey, effectiveModel, effort, fetcher, timeoutMs));
    report(index + 2, effort, `${effort} 推理强度测试完成`);
  }
  const successful = results.filter((item) => item.ok && item.canary);
  const status = modelsResponse.status === 401 || modelsResponse.status === 403
    ? "auth"
    : modelsOk || successful.length
      ? "ok"
      : modelsResponse.status >= 500
        ? "server"
        : "network";
  const protocol = modelsOk ? 25 : 0;
  const modelScore = selectedFound ? 15 : 0;
  const effort = effortScore(results);
  const stability = Math.round((successful.length / Math.max(1, results.length)) * 20);
  const speed = speedScore(results);
  const score = Math.max(0, Math.min(100, protocol + modelScore + effort + stability + speed));
  const result = {
    status,
    testedAt,
    httpStatus: modelsResponse.status || null,
    baseHost: baseUrl.host,
    model: effectiveModel,
    modelsCount: modelsResponse.entries.length,
    modelListed: selectedFound,
    declaredReasoningLevels: modelsResponse.declaredReasoningLevels,
    contextWindow: modelsResponse.contextWindow,
    efforts: results.map(({ effort: name, status: responseStatus, elapsedMs, ok, canary, hasResponseId, usage, error }) => ({
      effort: name,
      status: responseStatus,
      elapsedMs,
      ok,
      canary,
      hasResponseId,
      usage,
      error,
    })),
    score: {
      total: score,
      protocol,
      model: modelScore,
      effort,
      stability,
      speed,
    },
    assessment: assessmentFor({ modelsOk, selectedFound, results }),
    findings: findingsFor({ modelsResponse, selectedFound, results }),
    message: modelsOk
      ? `已完成 ${results.length} 个推理强度测试，综合分 ${score}/100`
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
  }, options);
  await recordProfileTest(id, result, paths);
  return { ...result, profile: { id: profile.id, name: profile.name, homepage: profile.homepage || null } };
}

export { DEFAULT_TIMEOUT_MS, EFFORTS, classifyHttp, safeNetworkReason };
