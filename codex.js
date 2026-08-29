import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import TOML from "@iarna/toml";
import { readJson, writeJson, encrypt, decrypt, maskSecret } from "./vault.js";
import { buildModelCatalog, buildSingleModelCatalog, isGptFamily } from "./model-catalog.js";

export function defaultPaths() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
}

export async function inspectCodex(paths = defaultPaths()) {
  const [config, auth, index] = await Promise.all([
    fs.readFile(paths.config, "utf8").catch(() => ""),
    fs.readFile(paths.auth, "utf8").catch(() => ""),
    fs.readFile(path.join(paths.home, "session_index.jsonl"), "utf8").catch(() => ""),
  ]);
  const provider = config.match(/^model_provider\s*=\s*["']([^"']+)/m)?.[1] || "unknown";
  return {
    home: paths.home,
    provider,
    hasAuth: Boolean(auth),
    authBytes: Buffer.byteLength(auth),
    sessionIndexEntries: index.split(/\r?\n/).filter(Boolean).length,
    configPreview: config.split(/\r?\n/).filter((line) => !/(key|token|secret|password)/i.test(line)).slice(0, 12),
  };
}

export async function liveProfileMatch(paths, profile, vaultFile) {
  const [configText, authText, vault] = await Promise.all([
    fs.readFile(paths.config, "utf8").catch(() => ""),
    fs.readFile(paths.auth, "utf8").catch(() => ""),
    readJson(vaultFile, { version: 1, profiles: {} }),
  ]);
  let config;
  let auth;
  try { config = parseToml(configText); } catch { return { matches: false, reason: "invalid-config" }; }
  try { auth = JSON.parse(authText); } catch { return { matches: false, reason: "invalid-auth" }; }

  if (profile.kind === "api") {
    const mode = apiRuntimeMode(profile);
    const provider = String(profile.runtimeProvider || profile.providerKey || profile.id).trim();
    const selected = config.model_provider === provider;
    const authMatches = String(auth.auth_mode || "").toLowerCase() === "apikey"
      && auth.OPENAI_API_KEY === profile.apiKey;
    const credentialsMatch = credentialConfigMatches(config);
    const definition = config.model_providers?.[provider];
    const providerExists = Boolean(definition && typeof definition === "object" && !Array.isArray(definition));
    const expectedBaseUrl = String(profile.baseUrl || "").trim().replace(/\/+$/, "");
    const actualBaseUrl = String(definition?.base_url || "").trim().replace(/\/+$/, "");
    const baseUrlMatches = mode === "gateway"
      ? /^https?:\/\/127\.0\.0\.1(?::\d+)?\/v1$/i.test(actualBaseUrl)
      : Boolean(expectedBaseUrl) && actualBaseUrl === expectedBaseUrl;
    const providerValid = providerExists
      && String(definition.wire_api || "").toLowerCase() === "responses"
      && baseUrlMatches;
    const matches = selected && authMatches && credentialsMatch && providerValid;
    const recoverableConfig = selected && authMatches && credentialsMatch && !providerValid;
    const reason = matches
      ? "api-match"
      : recoverableConfig
        ? providerExists ? "api-provider-invalid" : "api-provider-missing"
        : "api-mismatch";
    return { matches, reason, recoverableConfig };
  }

  const fingerprint = officialAuthFingerprint(authText);
  const savedAuth = vault.profiles[profile.id];
  const savedFingerprint = savedOfficialAuthFingerprint(savedAuth);
  const hasSavedAuth = Boolean(savedAuth?.auth);
  const matches = config.model_provider === "openai"
    && hasSavedAuth
    && Boolean(fingerprint)
    && savedFingerprint === fingerprint
    && credentialConfigMatches(config);
  return { matches, reason: matches ? "official-match" : "official-mismatch" };
}

export async function snapshotLiveFiles(paths) {
  const [config, auth] = await Promise.all([
    fs.readFile(paths.config).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
    fs.readFile(paths.auth).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
  ]);
  const modelCatalog = await fs.readFile(modelCatalogPath(paths)).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  return { config, auth, modelCatalog };
}

export async function restoreLiveFiles(paths, snapshot) {
  await fs.mkdir(paths.home, { recursive: true });
  await restoreFile(paths.auth, snapshot.auth);
  await restoreFile(paths.config, snapshot.config);
  await restoreFile(modelCatalogPath(paths), snapshot.modelCatalog ?? null);
}

async function backup(paths, suffix) {
  await fs.mkdir(paths.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const dir = path.join(paths.backupDir, `${stamp}-${suffix}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(paths.config, path.join(dir, "config.toml")).catch(() => {});
  await fs.copyFile(paths.auth, path.join(dir, "auth.json")).catch(() => {});
  await fs.copyFile(modelCatalogPath(paths), path.join(dir, "model-catalog.json")).catch(() => {});
  return dir;
}

export async function captureCurrent(paths, profile, vaultFile) {
  await fs.mkdir(paths.home, { recursive: true });
  const config = await fs.readFile(paths.config, "utf8").catch(() => "");
  const auth = await fs.readFile(paths.auth, "utf8").catch(() => "");
  const vault = await readJson(vaultFile, { version: 1, profiles: {} });
  const authFingerprint = profile.kind === "official" ? officialAuthFingerprint(auth) : null;
  if (profile.kind === "official" && !authFingerprint) {
    throw new Error("当前 Codex 不是官方 ChatGPT 登录状态，请先在 Codex 中登录该官方账号再捕获。");
  }
  const savedFingerprint = savedOfficialAuthFingerprint(vault.profiles[profile.id]);
  if (savedFingerprint && authFingerprint && savedFingerprint !== authFingerprint) {
    throw new Error("当前 Codex 登录的官方账号与该槽位不一致，已停止覆盖原账号快照。");
  }
  vault.profiles[profile.id] = {
    ...(vault.profiles[profile.id] || {}),
    auth: auth ? encrypt(auth) : null,
    authAccountFingerprint: authFingerprint,
    config: encrypt(config),
    capturedAt: new Date().toISOString(),
  };
  await writeJson(vaultFile, vault);
  return { id: profile.id, capturedAt: vault.profiles[profile.id].capturedAt, hasAuth: Boolean(auth) };
}

export async function switchProfile(paths, profile, vaultFile) {
  const vault = await readJson(vaultFile, { version: 1, profiles: {} });
  const saved = vault.profiles[profile.id];
  if (profile.kind === "official" && !saved?.auth) {
    throw new Error("该官方账号尚未捕获登录状态，请先在 Codex 中登录后点击“捕获当前账号”。");
  }
  const liveSnapshot = await snapshotLiveFiles(paths);
  const backupDir = await backup(paths, profile.id);
  const liveConfig = await fs.readFile(paths.config, "utf8").catch(() => "");
  const currentConfig = saved?.config ? decrypt(saved.config) : "";
  const activeModel = activeProfileModel(profile);
  const suppliedCatalog = Array.isArray(profile.modelCatalog) && profile.modelCatalog.length
    ? profile.modelCatalog
    : [activeModel].filter(Boolean);
  const singleModel = typeof profile.singleModel === "boolean" ? profile.singleModel : !isGptFamily(activeModel);
  const selectedEntry = suppliedCatalog.find((entry) => catalogEntryModelId(entry).toLowerCase() === activeModel.toLowerCase()) || activeModel;
  const gptCatalog = suppliedCatalog.filter((entry) => isGptFamily(catalogEntryModelId(entry)));
  const catalog = profile.kind === "api"
    ? singleModel
      ? buildSingleModelCatalog(selectedEntry, { providerName: profile.name || profile.providerKey || "API", platformLabel: profile.providerKey || profile.name || "API" })
      : buildModelCatalog(gptCatalog.length ? gptCatalog : [activeModel].filter(Boolean), { providerName: profile.name || profile.providerKey || "API" })
    : null;
  const config = profile.kind === "api"
    ? buildApiConfig(profile, liveConfig, modelCatalogPath(paths))
    : selectProfileModel(mergeCommonConfig(currentConfig || buildOfficialConfig(profile), liveConfig), profile, "openai");
  if (profile.kind === "api" && !profile.apiKey) throw new Error("中转 API 账号缺少 API Key。");
  const auth = profile.kind === "official"
    ? decrypt(saved.auth)
    : `${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: profile.apiKey }, null, 2)}\n`;
  if (profile.kind === "official" && !officialAuthFingerprint(auth)) {
    throw new Error("该槽位没有有效的官方 ChatGPT 登录快照，请重新登录并捕获。");
  }
  TOML.parse(config);
  JSON.parse(auth);
  try {
    await writeLiveFilesAtomic(paths, config, auth, catalog ? `${JSON.stringify(catalog, null, 2)}\n` : null);
    const applied = await liveProfileMatch(paths, profile, vaultFile);
    if (!applied.matches) {
      throw new Error(`目标账号 ${profile.name || profile.id} 的认证文件写入后校验失败（${applied.reason || "状态不一致"}）。`);
    }
  } catch (error) {
    await restoreLiveFiles(paths, liveSnapshot);
    throw error;
  }
  return { profile: profile.id, backupDir, config: config.split(/\r?\n/).filter(Boolean).length };
}

function buildOfficialConfig(profile) {
  const model = profile.model || "gpt-5.6";
  return `model = "${model}"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\n\n[model_providers.openai]\nname = "OpenAI"\nwire_api = "responses"\nrequires_openai_auth = true\n`;
}

function buildApiConfig(profile, liveConfig = "", catalogPath = "") {
  const model = activeProfileModel(profile);
  const mode = apiRuntimeMode(profile);
  const provider = mode === "gateway"
    ? (profile.runtimeProvider || profile.providerKey || profile.id || "galaxy")
    : (profile.runtimeProvider || profile.providerKey || profile.id || "relay");
  const config = parseToml(liveConfig);
  for (const key of ["base_url", "openai_base_url", "chatgpt_base_url", "model_catalog_json", "OPENAI_API_KEY"]) delete config[key];
  enforceFileCredentials(config);
  config.model = model;
  config.model_provider = provider;
  // Galaxy owns the active provider route.  Keeping stale provider tables from
  // an older relay makes Codex show multiple choices and can make users select
  // a URL that is not running anymore, so write only the current provider.
  config.model_providers = {
    [provider]: {
    name: profile.name,
    wire_api: "responses",
    base_url: profile.baseUrl,
    requires_openai_auth: true,
    },
  };
  if (catalogPath) config.model_catalog_json = catalogPath;
  return TOML.stringify(config);
}

// Profiles loaded from the v4 store always carry an explicit mode. Raw
// profiles without the field are treated as legacy gateway profiles so old
// low-level callers can repair their loopback configuration safely.
function apiRuntimeMode(profile) {
  if (profile?.kind !== "api") return "direct";
  return profile.runtimeMode === "direct" ? "direct" : "gateway";
}

function activeProfileModel(profile) {
  const model = Object.hasOwn(profile, "configuredModel")
    ? profile.model || profile.resolvedModel
    : profile.resolvedModel || profile.model;
  return String(model || "").trim();
}

function catalogEntryModelId(entry) {
  if (typeof entry === "string") return entry.trim();
  return String(entry?.sourceId || entry?.slug || entry?.id || entry?.model || "").trim();
}

function selectProfileModel(configText, profile, provider) {
  const config = parseToml(configText);
  delete config.model_catalog_json;
  enforceFileCredentials(config);
  config.model = profile.model;
  config.model_provider = provider;
  const existing = config.model_providers?.[provider];
  config.model_providers = {
    [provider]: existing || {
      name: "OpenAI",
      wire_api: "responses",
      requires_openai_auth: true,
    },
  };
  return TOML.stringify(config);
}

function mergeCommonConfig(targetText, liveText) {
  const target = parseToml(targetText);
  const live = parseToml(liveText);
  const providerKeys = new Set(["model", "model_provider", "base_url", "openai_base_url", "chatgpt_base_url", "model_catalog_json", "OPENAI_API_KEY", "model_providers"]);
  for (const [key, value] of Object.entries(live)) {
    if (!providerKeys.has(key)) target[key] = value;
  }
  return TOML.stringify(target);
}

function modelCatalogPath(paths) {
  return paths.modelCatalog || path.join(paths.home, "codex-galaxy-model-catalog.json");
}

function parseToml(text) {
  return text.trim() ? TOML.parse(text) : {};
}

function enforceFileCredentials(config) {
  delete config.forced_login_method;
  delete config.forced_chatgpt_workspace_id;
  config.cli_auth_credentials_store = "file";
}

function credentialConfigMatches(config) {
  return config.cli_auth_credentials_store === "file"
    && !Object.hasOwn(config, "forced_login_method")
    && !Object.hasOwn(config, "forced_chatgpt_workspace_id");
}

function officialAuthFingerprint(authText) {
  let auth;
  try { auth = JSON.parse(authText); } catch { return null; }
  const tokens = auth?.tokens && typeof auth.tokens === "object" ? auth.tokens : null;
  const looksOfficial = String(auth?.auth_mode || "").toLowerCase() === "chatgpt" || Boolean(tokens && Object.keys(tokens).length);
  if (!looksOfficial) return null;
  const identity = auth.account_id || tokens?.account_id || tokenIdentity(tokens?.id_token) || tokenIdentity(tokens?.access_token);
  return crypto.createHash("sha256").update(identity ? `account:${identity}` : "official-account-unidentified").digest("hex");
}

function savedOfficialAuthFingerprint(saved) {
  if (saved?.authAccountFingerprint) return saved.authAccountFingerprint;
  if (!saved?.auth) return null;
  try {
    return officialAuthFingerprint(decrypt(saved.auth));
  } catch {
    return null;
  }
}

function tokenIdentity(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded.chatgpt_account_id || decoded.account_id || decoded.sub || null;
  } catch {
    return null;
  }
}

async function writeLiveFilesAtomic(paths, config, auth, modelCatalog = null) {
  await fs.mkdir(paths.home, { recursive: true });
  const suffix = `${process.pid}-${Date.now()}`;
  const configTemp = `${paths.config}.${suffix}.tmp`;
  const authTemp = `${paths.auth}.${suffix}.tmp`;
  const catalogPath = modelCatalogPath(paths);
  const catalogTemp = `${catalogPath}.${suffix}.tmp`;
  const oldConfig = await fs.readFile(paths.config).catch(() => null);
  const oldAuth = await fs.readFile(paths.auth).catch(() => null);
  const oldCatalog = await fs.readFile(catalogPath).catch(() => null);
  await fs.writeFile(configTemp, config, { mode: 0o600 });
  await fs.writeFile(authTemp, auth, { mode: 0o600 });
  if (modelCatalog !== null) await fs.writeFile(catalogTemp, modelCatalog, { mode: 0o600 });
  try {
    await replaceFile(authTemp, paths.auth);
    await replaceFile(configTemp, paths.config);
    if (modelCatalog !== null) await replaceFile(catalogTemp, catalogPath);
    else await fs.rm(catalogPath, { force: true });
  } catch (error) {
    await restoreFile(paths.auth, oldAuth);
    await restoreFile(paths.config, oldConfig);
    await restoreFile(catalogPath, oldCatalog);
    await fs.rm(authTemp, { force: true });
    await fs.rm(configTemp, { force: true });
    await fs.rm(catalogTemp, { force: true });
    throw error;
  }
}

async function replaceFile(source, target) {
  await fs.rename(source, target);
}

async function restoreFile(target, contents) {
  if (contents === null) await fs.rm(target, { force: true });
  else await fs.writeFile(target, contents, { mode: 0o600 });
}

export { maskSecret };
