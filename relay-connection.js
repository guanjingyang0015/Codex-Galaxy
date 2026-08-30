import { modelsUrl } from "./responses-gateway.js";
import { profileForSwitch, recordProfileTest } from "./profiles.js";

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

export async function testApiProfile(id, paths, { fetcher = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const profile = await profileForSwitch(id, paths);
  if (profile.kind !== "api") throw new Error("只有中转 API 配置可以测试连接。");
  if (!profile.apiKey) throw new Error("中转账号还没有保存 API Key。");
  const testedAt = new Date().toISOString();
  let url;
  try {
    const baseUrl = new URL(String(profile.baseUrl || ""));
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error("invalid base URL");
    url = modelsUrl(baseUrl.toString());
  } catch {
    return persist(paths, id, { status: "invalid", testedAt, reason: "Base URL 格式不正确" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10000));
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${profile.apiKey}` },
      signal: controller.signal,
    });
    const status = classifyHttp(response.status);
    const result = { status, httpStatus: response.status, testedAt };
    // Discard without buffering the response because some providers may echo
    // sensitive data or return an unexpectedly large payload.
    try {
      if (typeof response.body?.cancel === "function") await response.body.cancel();
    } catch {}
    return persist(paths, id, result);
  } catch (error) {
    return persist(paths, id, { status: "network", testedAt, reason: safeNetworkReason(error) });
  } finally {
    clearTimeout(timer);
  }
}

async function persist(paths, id, result) {
  await recordProfileTest(id, result, paths);
  return {
    ...result,
    message: result.status === "ok"
      ? "连接成功，中转站模型接口可访问"
      : result.status === "auth"
        ? "连接到了中转站，但 API Key 无效或已失效"
        : result.status === "not-found"
          ? "中转站未提供 /models 接口，请检查 Base URL"
          : result.status === "invalid"
            ? "Base URL 格式不正确"
            : result.status === "server"
              ? "中转站暂时不可用（服务器错误）"
              : result.reason || "暂时无法确认中转站连接",
  };
}
