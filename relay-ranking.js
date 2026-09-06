export const RELAY_RANKING_BASE_URL = "https://api.vx314490015.cn";

function safeText(value, limit = 160) {
  return String(value || "").trim().slice(0, limit);
}

export function publicHomepage(value) {
  const text = safeText(value, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function siteKey(hostname) {
  const parts = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return parts.join(".");
  const suffix = parts.slice(-2).join(".");
  return ["com.cn", "net.cn", "org.cn", "co.uk", "com.au"].includes(suffix)
    ? parts.slice(-3).join(".")
    : suffix;
}

export function homepageMatchesBaseHost(homepage, baseHost) {
  try {
    const homepageUrl = new URL(publicHomepage(homepage));
    const normalizedBase = String(baseHost || "").toLowerCase().replace(/^\[|\]$/g, "").split(":")[0];
    return Boolean(normalizedBase) && siteKey(homepageUrl.hostname) === siteKey(normalizedBase);
  } catch {
    return false;
  }
}

export function sanitizeAuditForRanking(result, { providerName = "", homepage = "" } = {}) {
  const safeHomepage = homepageMatchesBaseHost(homepage, result?.baseHost) ? publicHomepage(homepage) : "";
  const efforts = Array.isArray(result?.efforts) ? result.efforts : [];
  return {
    provider_name: safeText(providerName || result?.baseHost || "未命名中转站", 100),
    base_host: safeText(result?.baseHost, 255).toLowerCase(),
    homepage: safeHomepage,
    model: safeText(result?.model, 160),
    expected_model: safeText(result?.expectedModel, 160),
    observed_model: safeText(result?.observedModel, 160),
    observed_models: Array.isArray(result?.observedModels)
      ? result.observedModels.map((item) => safeText(item, 160)).filter(Boolean).slice(0, 8)
      : [],
    model_verdict: safeText(result?.modelVerdict, 24),
    matches_desired_model: result?.matchesDesiredModel === true ? true : result?.matchesDesiredModel === false ? false : null,
    expected_model_listed: result?.expectedModelListed === true,
    models_status: Number.isInteger(result?.httpStatus) ? result.httpStatus : 0,
    models_count: Math.max(0, Math.min(512, Number(result?.modelsCount) || 0)),
    model_listed: result?.expectedModelListed === true,
    declared_reasoning_levels: Array.isArray(result?.declaredReasoningLevels)
      ? result.declaredReasoningLevels.map((item) => safeText(item, 20)).filter(Boolean).slice(0, 8)
      : [],
    efforts: efforts.slice(0, 4).map((item) => ({
      effort: safeText(item?.effort, 20),
      status: Number.isInteger(item?.status) ? item.status : 0,
      elapsed_ms: Math.max(0, Math.min(120_000, Number(item?.elapsedMs) || 0)),
      ok: item?.ok === true,
      canary: item?.canary === true,
      has_response_id: item?.hasResponseId === true,
      observed_models: Array.isArray(item?.observedModels)
        ? item.observedModels.map((value) => safeText(value, 160)).filter(Boolean).slice(0, 4)
        : [],
      usage: item?.usage ? {
        input_tokens: Math.max(0, Math.min(10_000_000, Number(item.usage.input_tokens) || 0)),
        output_tokens: Math.max(0, Math.min(10_000_000, Number(item.usage.output_tokens) || 0)),
        total_tokens: Math.max(0, Math.min(10_000_000, Number(item.usage.total_tokens) || 0)),
      } : null,
    })),
  };
}

export async function submitAuditForRanking(result, {
  providerName = "",
  homepage = "",
  baseUrl = RELAY_RANKING_BASE_URL,
  fetcher = globalThis.fetch,
  timeoutMs = 8000,
} = {}) {
  const payload = sanitizeAuditForRanking(result, { providerName, homepage });
  if (!payload.base_host || !payload.model) throw new Error("测试结果缺少中转站域名或模型，无法提交排名。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetcher(`${String(baseUrl).replace(/\/+$/, "")}/api/v1/audits`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(String(body.error || `排名服务返回 HTTP ${response.status}`));
  return body;
}

export async function fetchRelayRankings({
  baseUrl = RELAY_RANKING_BASE_URL,
  sort = "overall",
  model = "",
  fetcher = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  const params = new URLSearchParams();
  if (sort === "recent") params.set("sort", "recent");
  if (model) params.set("model", String(model));
  const query = params.size ? `?${params}` : "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetcher(`${String(baseUrl).replace(/\/+$/, "")}/api/v1/rankings${query}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`排名服务返回 HTTP ${response.status}`);
  const body = await response.json();
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    models: Array.isArray(body?.models) ? body.models : [],
    history90dMax: Math.max(0, Number(body?.history_90d_max) || 0),
    model: String(body?.model || ""),
    sort: String(body?.sort || sort),
  };
}
