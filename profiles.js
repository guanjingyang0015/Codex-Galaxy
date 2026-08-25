import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { readJson, writeJson, encrypt, decrypt } from "./vault.js";

const PROFILE_SCHEMA_VERSION = 3;

export function runtimePaths() {
  const root = process.env.CODEX_GALAXY_HOME || process.env.GALAXY_CHANNEL_HOME || path.join(os.homedir(), ".codex-galaxy");
  return { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "conversation-library.json"), settings: path.join(root, "settings.json") };
}

export async function loadProfiles(paths = runtimePaths()) {
  const data = await readJson(paths.profiles, { version: PROFILE_SCHEMA_VERSION, currentId: null, profiles: [] });
  const storedVersion = Number(data.version);
  if ((Number.isFinite(storedVersion) ? storedVersion : 1) < PROFILE_SCHEMA_VERSION) {
    data.profiles = (Array.isArray(data.profiles) ? data.profiles : []).map((profile) => (
      profile.kind === "api" ? { ...profile, preserveOfficialLogin: false } : profile
    ));
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
  if (!name) throw new Error("请填写账号名称。");
  if (input.kind === "official" && !model) throw new Error("请填写官方账号要使用的模型 ID。");
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(model)) throw new Error("模型 ID 包含不受支持的字符。");
  if (input.kind === 'api' && (!baseUrl || (!input.apiKey && !vault.profiles[id]?.apiKey))) throw new Error("中转账号需要 Base URL 和 API Key。");
  const profile = {
    id,
    name: name.slice(0, 80),
    kind: input.kind,
    baseUrl,
    // The visible profile id/name identifies the account. Codex itself uses a
    // fixed runtime provider for every API slot so session metadata stays the
    // same byte length and switching never rewrites whole histories.
    providerKey: input.kind === "api" ? "galaxy" : String(input.providerKey || previous?.providerKey || id).trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40),
    runtimeProvider: input.kind === "api" ? "galaxy" : "openai",
    model: model.slice(0, 160),
    preserveOfficialLogin: false,
    resolvedModel: previous?.model === model && previous?.baseUrl === baseUrl ? previous.resolvedModel || null : null,
    wireApi: "responses",
    updatedAt: new Date().toISOString(),
  };
  data.profiles = data.profiles.filter((item) => item.id !== profile.id).concat({ ...previous, ...profile });
  if (input.apiKey) vault.profiles[profile.id] = { ...(vault.profiles[profile.id] || {}), apiKey: encrypt(input.apiKey) };
  await writeJson(paths.profiles, data);
  await writeJson(paths.vault, vault);
  return profile;
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

export async function publicProfiles(paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  return { currentId: data.currentId, profiles: data.profiles.map((profile) => ({ ...profile, hasApiKey: Boolean(vault.profiles[profile.id]?.apiKey), hasAuthSnapshot: Boolean(vault.profiles[profile.id]?.auth) })) };
}

export async function profileForSwitch(id, paths = runtimePaths()) {
  const { data, vault } = await loadProfiles(paths);
  const profile = data.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`找不到账号 ${id}`);
  return {
    ...profile,
    runtimeProvider: profile.runtimeProvider || (profile.kind === "api" ? "galaxy" : "openai"),
    preserveOfficialLogin: false,
    apiKey: vault.profiles[id]?.apiKey ? decrypt(vault.profiles[id].apiKey) : null,
    auth: vault.profiles[id]?.auth ? decrypt(vault.profiles[id].auth) : null,
    savedConfig: vault.profiles[id]?.config ? decrypt(vault.profiles[id].config) : null,
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
