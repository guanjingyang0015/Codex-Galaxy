import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { readJson, writeJson, encrypt, decrypt } from "./vault.js";

const PROFILE_SCHEMA_VERSION = 6;
const MAX_MODEL_CATALOG_ENTRIES = 512;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/;

function providerKeyFor(profile) {
  const fallback = profile?.id || "relay";
  return String(profile?.providerKey || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40) || "relay";
}

function normalizeRuntimeMode(profile) {
  if (profile?.kind !== "api") return "direct";
  return profile?.runtimeMode === "gateway" ? "gateway" : "direct";
}

function normalizeModelCatalog(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const id = String(entry?.sourceId || entry?.slug || entry?.id || entry?.model || "").trim();
      if (!MODEL_ID_PATTERN.test(id)) return null;
      const key = id.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      const levels = Array.isArray(entry?.supported_reasoning_levels)
        ? entry.supported_reasoning_levels
          .map((level) => ({
            effort: String(level?.effort || "").trim(),
            description: String(level?.description || "").trim().slice(0, 320),
          }))
          .filter((level) => ["minimal", "low", "medium", "high", "xhigh"].includes(level.effort) && level.description)
          .slice(0, 8)
        : [];
      const contextWindow = entry?.context_window !== undefined && entry?.context_window !== null && String(entry.context_window).trim() !== ""
        ? Number(entry.context_window)
        : null;
      const maxContextWindow = entry?.max_context_window !== undefined && entry?.max_context_window !== null && String(entry.max_context_window).trim() !== ""
        ? Number(entry.max_context_window)
        : null;
      return {
        sourceId: id,
        display_name: String(entry?.display_name || entry?.name || id).trim().slice(0, 320) || id,
        description: String(entry?.description || "").trim().slice(0, 320),
        default_reasoning_level: String(entry?.default_reasoning_level || "").trim(),
        supported_reasoning_levels: levels,
        ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { context_window: contextWindow } : {}),
        ...(Number.isFinite(maxContextWindow) && maxContextWindow > 0 ? { max_context_window: maxContextWindow } : {}),
        input_modalities: Array.isArray(entry?.input_modalities) ? entry.input_modalities.map((value) => String(value)).slice(0, 8) : undefined,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_MODEL_CATALOG_ENTRIES);
}

export function runtimePaths() {
  const root = process.env.CODEX_GALAXY_HOME || process.env.GALAXY_CHANNEL_HOME || path.join(os.homedir(), ".codex-galaxy");
  return { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "conversation-library.json"), settings: path.join(root, "settings.json") };
}

export async function loadProfiles(paths = runtimePaths()) {
  const data = await readJson(paths.profiles, { version: PROFILE_SCHEMA_VERSION, currentId: null, profiles: [] });
  const storedVersion = Number(data.version);
  if ((Number.isFinite(storedVersion) ? storedVersion : 1) < PROFILE_SCHEMA_VERSION) {
    data.profiles = (Array.isArray(data.profiles) ? data.profiles : []).map((profile) => {
      if (profile.kind !== "api") return profile;
      const runtimeMode = normalizeRuntimeMode(profile);
      const providerKey = providerKeyFor(profile);
      return {
        ...profile,
        providerKey,
        runtimeMode,
        runtimeProvider: runtimeMode === "gateway" ? "galaxy" : providerKey,
        preserveOfficialLogin: true,
      };
    });
    data.version = PROFILE_SCHEMA_VERSION;
    await writeJson(paths.profiles, data);
  }
  const vault = await readJson(paths.vault, { version: 1, profiles: {} });
  return { data, vault };
}

export async function saveProfile(input, paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  const id = input.id || `${input.kind || "account"}-${crypto.randomUUID().slice(0, 8)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("账号 ID 只能包含字母、数字、下划线或短横线。");
  if (!['official', 'api'].includes(input.kind)) throw new Error("账号类型必须是 official 或 api。");
  const previous = data.profiles.find((item) => item.id === id);
  const name = String(input.name || "").trim();
  const model = String(input.model || "").trim();
  const baseUrl = String(input.baseUrl ?? previous?.baseUrl ?? "").trim();
  if (input.kind === "api") {
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error("Base URL 格式不正确，请填写 http:// 或 https:// 地址。"); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Base URL 只能使用 http:// 或 https:// 地址。");
    if (parsed.username || parsed.password) throw new Error("Base URL 不能包含用户名或密码，请使用 API Key 字段。");
  }
  const runtimeMode = input.kind === "api"
    ? (input.runtimeMode === "gateway" || input.runtimeMode === "direct"
      ? input.runtimeMode
      : normalizeRuntimeMode(previous || { kind: "api" }))
    : "direct";
  if (!name) throw new Error("请填写账号名称。");
  if (input.kind === "official" && !model) throw new Error("请填写官方账号要使用的模型 ID。");
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(model)) throw new Error("模型 ID 包含不受支持的字符。");
  const providedApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (input.kind === 'api' && (!baseUrl || (!providedApiKey && !vault.profiles[id]?.apiKey))) throw new Error("中转账号需要 Base URL 和 API Key。");
  const profile = {
    id,
    name: name.slice(0, 80),
    kind: input.kind,
    baseUrl,
    // Direct API slots use a stable provider key; the compatibility gateway
    // intentionally uses the shared local provider name.
    providerKey: input.kind === "api"
      ? providerKeyFor({ id, providerKey: input.providerKey || previous?.providerKey || id })
      : String(input.providerKey || previous?.providerKey || id).trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40),
    runtimeProvider: input.kind === "api" && runtimeMode === "gateway"
      ? "galaxy"
      : input.kind === "api"
        ? providerKeyFor({ id, providerKey: input.providerKey || previous?.providerKey || id })
        : "openai",
    runtimeMode,
    model: model.slice(0, 160),
    preserveOfficialLogin: input.kind === "api",
    resolvedModel: previous?.model === model && previous?.baseUrl === baseUrl ? previous.resolvedModel || null : null,
    modelCatalog: input.kind === "api"
      && previous?.kind === "api"
      && previous.baseUrl === baseUrl
      && previous.model === model
      ? normalizeModelCatalog(previous.modelCatalog)
      : [],
    lastTest: input.kind === "api" && previous?.kind === "api" && previous.baseUrl === baseUrl && !providedApiKey
      ? previous.lastTest || null
      : null,
    wireApi: "responses",
    updatedAt: new Date().toISOString(),
  };
  data.profiles = data.profiles.filter((item) => item.id !== profile.id).concat({ ...previous, ...profile });
  if (providedApiKey) vault.profiles[profile.id] = { ...(vault.profiles[profile.id] || {}), apiKey: encrypt(providedApiKey) };
  else if (input.kind !== "api" && vault.profiles[profile.id]?.apiKey) {
    const next = { ...vault.profiles[profile.id] };
    delete next.apiKey;
    if (Object.keys(next).length) vault.profiles[profile.id] = next;
    else delete vault.profiles[profile.id];
  }
  await writeJson(paths.profiles, data);
  await writeJson(paths.vault, vault);
  return profile;
}

export async function deleteProfile(id, paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  const profileId = String(id || "");
  const profile = data.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("找不到要删除的配置。");
  if (data.currentId === profileId) throw new Error("不能删除当前正在使用的配置，请先切换到其他账号或中转站。");
  data.profiles = data.profiles.filter((item) => item.id !== profileId);
  delete vault.profiles[profileId];
  await writeJson(paths.profiles, data);
  await writeJson(paths.vault, vault);
  return { id: profileId };
}

export async function clearApiKey(id, paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  const profileId = String(id || "");
  const profile = data.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("找不到要清除密钥的配置。");
  if (profile.kind !== "api") throw new Error("只有中转 API 配置才有 API Key。");
  if (data.currentId === profileId) throw new Error("不能清除当前正在使用的中转站 Key，请先切换到其他配置。");
  const cleared = Boolean(vault.profiles[profileId]?.apiKey);
  if (cleared) {
    const next = { ...vault.profiles[profileId] };
    delete next.apiKey;
    if (Object.keys(next).length) vault.profiles[profileId] = next;
    else delete vault.profiles[profileId];
  }
  profile.lastTest = null;
  profile.updatedAt = new Date().toISOString();
  await writeJson(paths.profiles, data);
  if (cleared) await writeJson(paths.vault, vault);
  return { id: profileId, cleared };
}

export async function recordProfileTest(id, result, paths = runtimePaths()) {
  const { data } = await loadProfiles(paths);
  const profile = data.profiles.find((item) => item.id === String(id || ""));
  if (!profile || profile.kind !== "api") return false;
  const status = ["ok", "auth", "not-found", "unsupported", "server", "network", "invalid"].includes(result?.status)
    ? result.status
    : "network";
  profile.lastTest = {
    status,
    httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
    testedAt: String(result?.testedAt || new Date().toISOString()),
  };
  profile.updatedAt = new Date().toISOString();
  await writeJson(paths.profiles, data);
  return true;
}

export async function setResolvedModel(id, configuredModel, resolvedModel, paths = runtimePaths()) {
  const { data } = await loadProfiles(paths);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile || profile.kind !== "api" || profile.model !== configuredModel) return false;
  const resolved = String(resolvedModel || "").trim();
  if (resolved && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(resolved)) return false;
  if (!resolved || resolved === profile.model) {
    if (!profile.resolvedModel) return false;
    profile.resolvedModel = null;
  } else {
    const configured = profile.model.toLowerCase();
    const candidate = resolved.toLowerCase();
    if (configured && !["-", "/", ":", ".", "@", "+", "_"].some((separator) => candidate.startsWith(`${configured}${separator}`))) return false;
    if (profile.resolvedModel === resolved) return false;
    profile.resolvedModel = resolved;
  }
  profile.updatedAt = new Date().toISOString();
  await writeJson(paths.profiles, data);
  return true;
}

export async function setModelCatalog(id, configuredModel, baseUrl, modelCatalog, paths = runtimePaths()) {
  const { data } = await loadProfiles(paths);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile || profile.kind !== "api") return false;
  if (String(profile.model || "") !== String(configuredModel || "")) return false;
  if (String(profile.baseUrl || "").replace(/\/+$/, "") !== String(baseUrl || "").replace(/\/+$/, "")) return false;
  profile.modelCatalog = normalizeModelCatalog(modelCatalog);
  profile.updatedAt = new Date().toISOString();
  await writeJson(paths.profiles, data);
  return true;
}

export async function publicProfiles(paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  return {
    currentId: data.currentId,
    profiles: data.profiles.map((profile) => ({
      ...profile,
      modelCatalog: undefined,
      modelCatalogCount: Array.isArray(profile.modelCatalog) ? profile.modelCatalog.length : 0,
      hasApiKey: Boolean(vault.profiles[profile.id]?.apiKey),
      hasAuthSnapshot: Boolean(vault.profiles[profile.id]?.auth),
    })),
  };
}

export async function profileForSwitch(id, paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`找不到账号 ${id}`);
  return {
    ...profile,
    runtimeMode: normalizeRuntimeMode(profile),
    runtimeProvider: profile.kind === "api"
      ? (normalizeRuntimeMode(profile) === "gateway" ? "galaxy" : providerKeyFor(profile))
      : "openai",
    preserveOfficialLogin: profile.kind === "api",
    apiKey: vault.profiles[id]?.apiKey ? decrypt(vault.profiles[id].apiKey) : null,
    auth: vault.profiles[id]?.auth ? decrypt(vault.profiles[id].auth) : null,
    savedConfig: vault.profiles[id]?.config ? decrypt(vault.profiles[id].config) : null,
    modelCatalog: normalizeModelCatalog(profile.modelCatalog),
  };
}

export async function setCurrent(id, paths = runtimePaths()) {
  const { data } = await loadProfiles(paths);
  data.currentId = id;
  await writeJson(paths.profiles, data);
}

export function safeProfile(profile) {
  const { apiKey, auth, savedConfig, ...safe } = profile;
  return safe;
}
