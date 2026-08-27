import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { once } from "node:events";
import { catalogEntries, catalogModelIds, isGptFamily } from "./model-catalog.js";

const DEFAULT_PORT = 43821;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_MODEL_CATALOG_BYTES = 2 * 1024 * 1024;
const MODEL_CATALOG_TIMEOUT_MS = 8000;
const DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS = 15000;
const requestHopByHopHeaders = new Set(["connection", "content-length", "host", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const responseHopByHopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);

function responseEndpoint(pathname) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/responses/compact" || normalized === "/v1/responses/compact") return "/responses/compact";
  if (normalized === "/responses" || normalized === "/v1/responses") return "/responses";
  return null;
}

function metadataRequestsCompaction(value) {
  if (Array.isArray(value)) return value.some(metadataRequestsCompaction);
  if (value && typeof value === "object") {
    if (String(value.request_kind || "").toLowerCase() === "compaction") return true;
    return Object.values(value).some(metadataRequestsCompaction);
  }
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "compaction") return true;
  try {
    return metadataRequestsCompaction(JSON.parse(trimmed));
  } catch {
    return /request_kind["'\s=:]+compaction/i.test(trimmed);
  }
}

function isCompactionRequest(endpoint, headers, body) {
  if (endpoint === "/responses/compact") return true;
  return metadataRequestsCompaction(headers["x-codex-turn-metadata"])
    || metadataRequestsCompaction(body?.client_metadata?.["x-codex-turn-metadata"]);
}

function modelFamilyMatches(configuredModel, candidateModel) {
  const configured = String(configuredModel || "").trim().toLowerCase();
  const candidate = String(candidateModel || "").trim().toLowerCase();
  if (!configured || !candidate) return false;
  return candidate === configured
    || ["-", "/", ":", ".", "@", "+", "_"].some((separator) => candidate.startsWith(`${configured}${separator}`));
}

function modelCanResolveVariants(configuredModel) {
  const configured = String(configuredModel || "").trim().toLowerCase();
  if (!configured) return true;
  const tail = configured.split(/[\/:@+_]/).at(-1);
  return /(?:^|-)v?\d+(?:\.\d+)*$/.test(tail);
}

async function responseSuggestsModelAccessFailure(response) {
  if (![400, 403, 404].includes(response?.status) || typeof response.clone !== "function") return false;
  let text = "";
  try { text = (await response.clone().text()).slice(0, 16 * 1024).toLowerCase(); } catch { return false; }
  const mentionsModel = /model|模型/.test(text);
  const mentionsAccess = /access|permission|forbidden|unauthori[sz]ed|not found|does not exist|unavailable|unsupported|访问|权限|无权|未授权|不存在|不可用|不支持/.test(text);
  return mentionsModel && mentionsAccess;
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(headers, apiKey) {
  const authorization = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  return timingSafeStringEqual(authorization, `Bearer ${apiKey}`);
}

async function readRequestBody(request, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      const error = new Error("请求内容超过本地网关限制。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstreamUrl(baseUrl, endpoint, incomingUrl) {
  const target = new URL(baseUrl);
  let root = target.pathname.replace(/\/+$/, "");
  root = root.replace(/\/responses(?:\/compact)?$/i, "");
  target.pathname = `${root}${endpoint}` || endpoint;
  const incoming = new URL(incomingUrl, "http://127.0.0.1");
  for (const [key, value] of incoming.searchParams) target.searchParams.append(key, value);
  return target;
}

function modelsUrl(baseUrl) {
  const target = new URL(baseUrl);
  let root = target.pathname.replace(/\/+$/, "");
  root = root.replace(/\/responses(?:\/compact)?$/i, "");
  target.pathname = `${root}/models` || "/models";
  target.search = "";
  return target;
}

function outboundHeaders(incoming, apiKey, length) {
  const headers = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (!requestHopByHopHeaders.has(name.toLowerCase()) && !name.toLowerCase().startsWith("sec-") && value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  headers.authorization = `Bearer ${apiKey}`;
  if (length !== null) headers["content-length"] = String(length);
  return headers;
}

function forwardResponseHeaders(incoming, decodedFetchBody = false) {
  const headers = {};
  const entries = typeof incoming?.entries === "function" ? incoming.entries() : Object.entries(incoming || {});
  for (const [name, value] of entries) {
    const normalized = name.toLowerCase();
    if (decodedFetchBody && (normalized === "content-encoding" || normalized === "content-length")) continue;
    if (!responseHopByHopHeaders.has(normalized) && value !== undefined) headers[name] = value;
  }
  return headers;
}

function upstreamFailureMessage(error) {
  const detail = [error?.code, error?.cause?.code, error?.name, error?.message, error?.cause?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/enotfound|eai_again|name_not_resolved|dns/.test(detail)) return "上游 Responses API 域名解析失败（DNS）。";
  if (/cert|certificate|tls|ssl/.test(detail)) return "上游 Responses API 的 TLS/证书连接失败。";
  if (/timed?out|etimedout|connect_timeout/.test(detail)) return "连接上游 Responses API 超时。";
  if (/proxy|tunnel|407/.test(detail)) return "系统代理无法连接上游 Responses API。";
  if (/econnrefused|connection_refused/.test(detail)) return "上游 Responses API 拒绝了网络连接。";
  return "上游 Responses API 暂时无法连接（网络、系统代理或上游服务异常）。";
}

function upstreamStreamFailureMessage(error) {
  const detail = [error?.code, error?.cause?.code, error?.name, error?.message, error?.cause?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/abort|aborted|cancel/.test(detail)) return "上游 Responses 流式请求已取消，请重试。";
  if (/decode|decoding|decompress|content.?encoding|body|stream|socket|econnreset|eof|premature/.test(detail)) {
    return "上游 Responses 流式响应中断，请重试；如果持续出现，请检查中转站状态或网络。";
  }
  return "上游 Responses 流式连接中断，请重试；如果持续出现，请检查中转站状态或网络。";
}

function isEventStream(headers) {
  const value = typeof headers?.get === "function"
    ? headers.get("content-type")
    : headers?.["content-type"];
  return String(value || "").toLowerCase().includes("text/event-stream");
}

function finishStreamWithError(response, error) {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify({
    type: "error",
    error: { message: upstreamStreamFailureMessage(error) },
  });
  response.write(`event: error\ndata: ${payload}\n\n`);
  response.end();
}

function waitForDrain(response) {
  if (response.destroyed) return Promise.resolve(false);
  return new Promise((resolve) => {
    const cleanup = () => {
      response.off("drain", onDrain);
      response.off("close", onClose);
    };
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    response.once("drain", onDrain);
    response.once("close", onClose);
  });
}

function startStreamHeartbeat(response, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  let timer = null;
  timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) return;
    try {
      response.write(": galaxy-keepalive\n\n");
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function ensureEventStreamHeaders(headers) {
  if (!isEventStream(headers)) return headers;
  return {
    ...headers,
    "cache-control": headers["cache-control"] || "no-cache, no-transform",
    "x-accel-buffering": headers["x-accel-buffering"] || "no",
  };
}

async function pipeFetchBody(upstreamResponse, response, { heartbeatIntervalMs = DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS } = {}) {
  if (!upstreamResponse.body) {
    response.end();
    return { completed: true };
  }
  const reader = upstreamResponse.body.getReader();
  const heartbeat = isEventStream(upstreamResponse.headers) ? startStreamHeartbeat(response, heartbeatIntervalMs) : null;
  let error = null;
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value)) && !await waitForDrain(response)) break;
    }
  } catch (caught) {
    error = caught;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    reader.releaseLock();
  }
  if (!response.destroyed) {
    if (error && isEventStream(upstreamResponse.headers)) finishStreamWithError(response, error);
    else response.end();
  }
  return { completed: !error, error };
}

function pipeNodeBody(upstreamResponse, response, { heartbeatIntervalMs = DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const heartbeat = isEventStream(upstreamResponse.headers) ? startStreamHeartbeat(response, heartbeatIntervalMs) : null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      resolve();
    };
    upstreamResponse.on("data", (chunk) => {
      if (!response.destroyed && !response.write(chunk)) upstreamResponse.pause();
    });
    response.on("drain", () => upstreamResponse.resume());
    upstreamResponse.once("end", () => {
      if (!response.destroyed && !response.writableEnded) response.end();
      finish();
    });
    upstreamResponse.once("error", (error) => {
      if (!response.destroyed && isEventStream(upstreamResponse.headers)) finishStreamWithError(response, error);
      else if (!response.destroyed && !response.writableEnded) response.end();
      finish();
    });
    response.once("close", () => {
      if (!settled) upstreamResponse.destroy();
      finish();
    });
  });
}

function sendJson(response, statusCode, message) {
  if (response.headersSent) return response.end();
  const body = Buffer.from(JSON.stringify({ error: { message } }));
  response.writeHead(statusCode, { "content-type": "application/json", "content-length": String(body.length) });
  response.end(body);
}

function catalogItemId(item) {
  if (typeof item === "string") return item.trim();
  return String(item?.sourceId || item?.slug || item?.id || item?.model || "").trim();
}

function catalogForSelection(entries, selectedModel, singleModel, providerName) {
  const source = Array.isArray(entries) && entries.length ? entries : [selectedModel];
  const normalized = catalogEntries({ models: source }, providerName);
  if (singleModel) {
    const selected = normalized.find((entry) => catalogItemId(entry).toLowerCase() === selectedModel.toLowerCase());
    return selected ? [selected] : catalogEntries({ models: [selectedModel] }, providerName);
  }
  const gptModels = normalized.filter((entry) => isGptFamily(catalogItemId(entry)));
  return gptModels.length ? gptModels : catalogEntries({ models: [selectedModel] }, providerName);
}

function validateProfile(profile) {
  if (profile?.kind !== "api") throw new Error("本地网关只能用于中转 API 账号。");
  const apiKey = String(profile.apiKey || "");
  const model = String(profile.model || "").trim();
  if (!apiKey) throw new Error("中转 API 账号缺少 API Key。");
  if (!model) throw new Error("中转站没有提供可自动使用的模型，请编辑账号并填写模型 ID。");
  let baseUrl;
  try {
    baseUrl = new URL(String(profile.baseUrl || ""));
  } catch {
    throw new Error("中转 API Base URL 无效。");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new Error("中转 API Base URL 必须是有效的 HTTP(S) 地址，且不能包含账号密码。");
  }
  const configuredModel = Object.hasOwn(profile, "configuredModel")
    ? String(profile.configuredModel || "").trim()
    : model;
  const modelCandidates = Array.isArray(profile.modelCandidates)
    ? [...new Set(profile.modelCandidates.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 512)
    : [];
  const modelCatalog = Array.isArray(profile.modelCatalog) ? profile.modelCatalog.slice(0, 512) : [];
  const singleModel = profile.singleModel === true;
  const selectedCatalog = singleModel
    ? modelCatalog.filter((entry) => catalogItemId(entry).toLowerCase() === model.toLowerCase())
    : modelCatalog;
  return {
    id: profile.id,
    baseUrl: baseUrl.toString(),
    apiKey,
    model,
    configuredModel,
    modelCandidates: singleModel ? [] : modelCandidates,
    modelCatalog: selectedCatalog,
    singleModel,
  };
}

export class ResponsesGateway {
  constructor({ host = "127.0.0.1", port = Number(process.env.CODEX_GALAXY_GATEWAY_PORT || DEFAULT_PORT), maxRequestBytes = MAX_REQUEST_BYTES, fetchUpstream = null, onModelResolved = null, streamHeartbeatIntervalMs = DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS } = {}) {
    if (host !== "127.0.0.1") throw new Error("本地网关只允许监听 127.0.0.1。");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("本地网关端口无效。");
    if (fetchUpstream !== null && typeof fetchUpstream !== "function") throw new Error("上游网络传输无效。");
    if (onModelResolved !== null && typeof onModelResolved !== "function") throw new Error("模型解析回调无效。");
    this.host = host;
    this.port = port;
    this.maxRequestBytes = maxRequestBytes;
    this.fetchUpstream = fetchUpstream;
    this.onModelResolved = onModelResolved;
    this.streamHeartbeatIntervalMs = Number.isFinite(streamHeartbeatIntervalMs) && streamHeartbeatIntervalMs > 0
      ? streamHeartbeatIntervalMs
      : 0;
    this.server = null;
    this.active = null;
    this.inFlight = 0;
    this.idleWaiters = new Set();
  }

  configure(profile) {
    this.active = validateProfile(profile);
  }

  async resolveProfile(profile, { preferredModels = [] } = {}) {
    const configuredModel = String(profile.configuredModel || profile.model || "").trim();
    const resolveVariants = modelCanResolveVariants(configuredModel);
    const storedResolvedModel = configuredModel && resolveVariants
      ? (modelFamilyMatches(configuredModel, profile.resolvedModel) ? String(profile.resolvedModel).trim() : null)
      : !configuredModel ? String(profile.resolvedModel || "").trim() || null : null;
    const locallyObservedModel = preferredModels.find((model) => {
      const candidate = String(model || "").trim();
      return candidate && (!configuredModel || (resolveVariants && modelFamilyMatches(configuredModel, candidate)))
        && candidate.toLowerCase() !== configuredModel.toLowerCase();
    });
    const fallbackModel = storedResolvedModel || locallyObservedModel || configuredModel;
    let active;
    try {
      active = validateProfile({ ...profile, configuredModel, model: fallbackModel });
    } catch (error) {
      if (fallbackModel) throw error;
      active = validateProfile({ ...profile, configuredModel, model: "model-discovery-placeholder" });
    }
    const transport = this.fetchUpstream || globalThis.fetch;
    const providerName = profile.name || profile.providerKey || "API";
    const fallbackSingleModel = fallbackModel ? !isGptFamily(fallbackModel) : false;
    const fallback = fallbackModel ? {
      ...profile,
      model: fallbackModel,
      configuredModel,
      modelResolved: fallbackModel !== configuredModel,
      modelCandidates: fallbackSingleModel ? [] : (Array.isArray(profile.modelCandidates) ? profile.modelCandidates : []),
      modelCatalog: catalogForSelection(profile.modelCatalog, fallbackModel, fallbackSingleModel, providerName),
      singleModel: fallbackSingleModel,
    } : null;
    if (typeof transport !== "function") {
      if (fallback) return fallback;
      throw new Error("无法读取中转站模型列表，请编辑账号并填写模型 ID。");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
    try {
      const response = await transport(modelsUrl(active.baseUrl).toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${active.apiKey}`, accept: "application/json", "accept-encoding": "identity" },
        signal: controller.signal,
      });
      if (!response?.ok) {
        if (fallback) return fallback;
        throw new Error("中转站未提供可读取的模型列表，请编辑账号并填写模型 ID。");
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_MODEL_CATALOG_BYTES) {
        if (fallback) return fallback;
        throw new Error("中转站模型列表过大，无法自动选择，请编辑账号并填写模型 ID。");
      }
      let payload;
      try { payload = JSON.parse(bytes.toString("utf8")); } catch {
        if (fallback) return fallback;
        throw new Error("中转站模型列表格式无效，请编辑账号并填写模型 ID。");
      }
      const modelCatalog = catalogEntries(payload, providerName);
      const models = catalogModelIds(modelCatalog);
      const exact = configuredModel ? models.find((model) => model.toLowerCase() === configuredModel.toLowerCase()) : null;
      const compatible = configuredModel
        ? (resolveVariants ? models.filter((model) => modelFamilyMatches(configuredModel, model)) : exact ? [exact] : [])
        : models;
      if (!compatible.length) {
        if (fallback) return fallback;
        throw new Error("中转站模型列表为空，请编辑账号并填写模型 ID。");
      }
      const stored = storedResolvedModel && compatible.find((candidate) => candidate.toLowerCase() === String(storedResolvedModel).toLowerCase());
      const preferred = preferredModels.find((model) => compatible.some((candidate) => candidate.toLowerCase() === String(model).toLowerCase()));
      const preferredCandidate = preferred && compatible.find((candidate) => candidate.toLowerCase() === String(preferred).toLowerCase());
      const fallbackCandidate = fallback?.model && compatible.find((candidate) => candidate.toLowerCase() === fallback.model.toLowerCase());
      const resolvedModel = stored
        || preferredCandidate
        || exact
        || fallbackCandidate
        || (configuredModel ? fallback?.model : null)
        || compatible[0];
      const singleModel = !isGptFamily(resolvedModel);
      const resolvedCatalog = catalogForSelection(modelCatalog, resolvedModel, singleModel, providerName);
      return {
        ...profile,
        model: resolvedModel,
        configuredModel,
        modelResolved: resolvedModel !== configuredModel,
        modelCandidates: singleModel ? [] : compatible.filter((model) => model.toLowerCase() !== resolvedModel.toLowerCase()),
        modelCatalog: resolvedCatalog,
        singleModel,
      };
    } catch (error) {
      if (fallback) return fallback;
      if (error instanceof Error && /请编辑账号并填写模型 ID/.test(error.message)) throw error;
      throw new Error("无法从中转站自动获取模型，请检查网络，或编辑账号并填写模型 ID。");
    } finally {
      clearTimeout(timeout);
    }
  }

  snapshot() {
    return { active: this.active ? { ...this.active } : null, running: Boolean(this.server?.listening) };
  }

  async restore(snapshot) {
    this.active = snapshot?.active ? { ...snapshot.active } : null;
    if (snapshot?.running) await this.start();
    else await this.stop();
  }

  get baseUrl() {
    if (!this.server?.listening) throw new Error("本地网关尚未启动。");
    const address = this.server.address();
    return `http://${this.host}:${address.port}/v1`;
  }

  get status() {
    return {
      running: Boolean(this.server?.listening),
      profileId: this.active?.id || null,
      model: this.active?.model || null,
      baseUrl: this.server?.listening ? this.baseUrl : null,
    };
  }

  async start() {
    if (!this.active) throw new Error("本地网关尚未配置中转 API 账号。");
    if (this.server?.listening) return this.status;
    const server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        sendJson(response, Number(error?.statusCode) || 502, error?.publicMessage || "本地网关无法完成请求。");
      });
    });
    server.on("clientError", (_error, socket) => {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
    this.server = server;
    server.listen(this.port, this.host);
    try {
      await Promise.race([
        once(server, "listening"),
        once(server, "error").then(([error]) => Promise.reject(error)),
      ]);
    } catch (error) {
      this.server = null;
      if (error?.code === "EADDRINUSE") throw new Error(`本地网关端口 ${this.port} 已被占用，请关闭占用程序后重试。`);
      throw error;
    }
    return this.status;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (!server?.listening) return;
    server.close();
    server.closeIdleConnections?.();
    await once(server, "close");
  }

  async handle(request, response) {
    this.inFlight += 1;
    try {
      return await this.handleRequest(request, response);
    } finally {
      this.inFlight -= 1;
      if (this.inFlight === 0) {
        for (const resolve of this.idleWaiters) resolve(true);
        this.idleWaiters.clear();
      }
    }
  }

  async waitForIdle(timeoutMs = 30000) {
    if (this.inFlight === 0) return true;
    const duration = Math.max(0, Number(timeoutMs) || 0);
    if (duration === 0) return false;
    return new Promise((resolve) => {
      let timer = null;
      const finish = (value) => {
        if (timer) clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(value);
      };
      const onIdle = () => finish(true);
      this.idleWaiters.add(onIdle);
      if (duration > 0) timer = setTimeout(() => finish(false), duration);
    });
  }

  async handleRequest(request, response) {
    const active = this.active ? { ...this.active } : null;
    if (!active) return sendJson(response, 503, "本地网关尚未激活账号。");
    if (request.method !== "POST") return sendJson(response, 405, "本地网关只接受 Responses POST 请求。");
    const endpoint = responseEndpoint(new URL(request.url, "http://127.0.0.1").pathname);
    if (!endpoint) return sendJson(response, 404, "本地网关只代理 Responses API。");
    if (!authorized(request.headers, active.apiKey)) return sendJson(response, 401, "本地网关授权失败。");

    const rawBody = await readRequestBody(request, this.maxRequestBytes);
    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return sendJson(response, 400, "Responses 请求体不是有效 JSON。");
    }

    const incomingModel = typeof body.model === "string" ? body.model.trim() : "";
    const catalogModels = [
      active.model,
      ...active.modelCandidates,
      ...catalogModelIds(active.modelCatalog),
    ].filter(Boolean);
    const exactCatalogMatch = catalogModels.some((model) => model.toLowerCase() === incomingModel.toLowerCase());
    const familyCatalogMatch = !active.singleModel
      && Boolean(active.configuredModel)
      && modelCanResolveVariants(active.configuredModel)
      && modelFamilyMatches(active.configuredModel, incomingModel)
      && incomingModel.toLowerCase() !== active.configuredModel.toLowerCase();
    const compatibleSelectedModel = Boolean(incomingModel && !active.singleModel && (exactCatalogMatch || familyCatalogMatch));
    const outboundModel = compatibleSelectedModel ? incomingModel : active.model;
    const outboundBody = incomingModel === outboundModel
      ? rawBody
      : Buffer.from(JSON.stringify({ ...body, model: outboundModel }));

    const target = upstreamUrl(active.baseUrl, endpoint, request.url);
    try {
      if (this.fetchUpstream) {
        const controller = new AbortController();
        const abort = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.once("close", abort);
        try {
          const headers = outboundHeaders(request.headers, active.apiKey, null);
          headers["accept-encoding"] = "identity";
          let upstreamResponse = await this.fetchUpstream(target.toString(), {
            method: "POST",
            headers,
            body: outboundBody,
            signal: controller.signal,
          });
          if (await responseSuggestsModelAccessFailure(upstreamResponse)) {
            for (const candidate of active.modelCandidates.filter((model) => model !== outboundModel).slice(0, 4)) {
              await upstreamResponse.body?.cancel?.().catch?.(() => {});
              const retryBody = Buffer.from(JSON.stringify({ ...body, model: candidate }));
              const retryResponse = await this.fetchUpstream(target.toString(), {
                method: "POST",
                headers,
                body: retryBody,
                signal: controller.signal,
              });
              upstreamResponse = retryResponse;
              if (retryResponse.status >= 200 && retryResponse.status < 400) {
                if (this.active?.id === active.id) this.active.model = candidate;
                Promise.resolve(this.onModelResolved?.({ profileId: active.id, configuredModel: active.configuredModel, resolvedModel: candidate })).catch(() => {});
                break;
              }
            }
          }
          if (compatibleSelectedModel && !isCompactionRequest(endpoint, request.headers, body) && upstreamResponse.status >= 200 && upstreamResponse.status < 400 && this.active?.id === active.id) {
            this.active.model = incomingModel;
            Promise.resolve(this.onModelResolved?.({ profileId: active.id, configuredModel: active.configuredModel, resolvedModel: incomingModel })).catch(() => {});
          }
          response.writeHead(
            upstreamResponse.status || 502,
            ensureEventStreamHeaders(forwardResponseHeaders(upstreamResponse.headers, true)),
          );
          await pipeFetchBody(upstreamResponse, response, { heartbeatIntervalMs: this.streamHeartbeatIntervalMs });
        } finally {
          response.off("close", abort);
        }
      } else {
        const transport = target.protocol === "https:" ? https : http;
        await new Promise((resolve, reject) => {
          const upstream = transport.request(target, {
            method: "POST",
            headers: outboundHeaders(request.headers, active.apiKey, outboundBody.length),
          }, (upstreamResponse) => {
            if (compatibleSelectedModel && !isCompactionRequest(endpoint, request.headers, body) && (upstreamResponse.statusCode || 500) < 400 && this.active?.id === active.id) {
              this.active.model = incomingModel;
              Promise.resolve(this.onModelResolved?.({ profileId: active.id, configuredModel: active.configuredModel, resolvedModel: incomingModel })).catch(() => {});
            }
            response.writeHead(
              upstreamResponse.statusCode || 502,
              ensureEventStreamHeaders(forwardResponseHeaders(upstreamResponse.headers)),
            );
            pipeNodeBody(upstreamResponse, response, { heartbeatIntervalMs: this.streamHeartbeatIntervalMs }).then(resolve, reject);
          });
          upstream.once("error", reject);
          response.once("close", () => {
            if (!response.writableEnded) upstream.destroy();
          });
          upstream.end(outboundBody);
        });
      }
    } catch (error) {
      if (response.destroyed && !response.headersSent) return;
      if (response.headersSent) {
        if (isEventStream(response.getHeaders?.())) finishStreamWithError(response, error);
        else response.end();
        return;
      }
      const wrapped = new Error(upstreamFailureMessage(error));
      wrapped.publicMessage = wrapped.message;
      wrapped.statusCode = 502;
      throw wrapped;
    }
  }
}

export async function prepareGatewayRuntime(gateway, profile, options = {}) {
  const before = gateway.snapshot();
  try {
    if (profile.kind === "api") {
      const resolvedProfile = await gateway.resolveProfile(profile, options);
      gateway.configure(resolvedProfile);
      await gateway.start();
      return {
        profile: { ...resolvedProfile, baseUrl: gateway.baseUrl },
        forceApply: true,
        commit: async () => {},
        rollback: () => gateway.restore(before),
      };
    }
    return {
      profile,
      forceApply: false,
      commit: () => gateway.stop(),
      rollback: () => gateway.restore(before),
    };
  } catch (error) {
    await gateway.restore(before).catch(() => {});
    throw error;
  }
}

export { isCompactionRequest, modelCanResolveVariants, modelFamilyMatches, modelsUrl, responseSuggestsModelAccessFailure, upstreamUrl };
