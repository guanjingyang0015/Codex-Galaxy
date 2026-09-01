import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { captureCurrent, liveProfileMatch, switchProfile } from "../codex.js";

test("API switching preserves common config and writes an arbitrary model", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-switch-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
  const vaultFile = path.join(home, "vault.json");
  await fs.writeFile(paths.config, 'model = "old-model"\nmodel_provider = "openai"\ncli_auth_credentials_store = "keyring"\nmodel_context_window = 128000\nmodel_auto_compact_token_limit = 115200\nmodel_auto_compact_token_limit_scope = "total"\nforced_login_method = "chatgpt"\nforced_chatgpt_workspace_id = "workspace-old"\n\n[model_providers.custom]\nname = "Stale relay"\nwire_api = "responses"\nbase_url = "https://stale.invalid/v1"\n\n[mcp_servers.keep]\ncommand = "keep-me"\n');
  await fs.writeFile(paths.auth, '{"tokens":{"access_token":"not-a-real-token"}}\n');

  await switchProfile(paths, {
    id: "relay-b",
    name: "DeepSeek relay",
    kind: "api",
    providerKey: "relay-deepseek",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    model: "deepseek-reasoner",
    runtimeMode: "direct",
    singleModel: true,
    modelCatalog: [{
      sourceId: "deepseek-reasoner",
      display_name: "DeepSeek R1",
      description: "DeepSeek reasoning model",
      context_window: 131072,
    }],
  }, vaultFile);

  const configText = await fs.readFile(paths.config, "utf8");
  const config = TOML.parse(configText);
  assert.equal(config.model, "deepseek-reasoner");
  assert.equal(config.model_provider, "relay-deepseek");
  assert.equal(config.model_providers["relay-deepseek"].wire_api, "responses");
  assert.deepEqual(Object.keys(config.model_providers), ["relay-deepseek"]);
  assert.equal(config.model_catalog_json, paths.modelCatalog);
  assert.equal(config.cli_auth_credentials_store, "file");
  assert.equal(config.model_context_window, undefined);
  assert.equal(config.model_auto_compact_token_limit, undefined);
  assert.equal(config.model_auto_compact_token_limit_scope, undefined);
  assert.equal(config.forced_login_method, undefined);
  assert.equal(config.forced_chatgpt_workspace_id, undefined);
  assert.equal(config.mcp_servers.keep.command, "keep-me");
  assert.equal(configText.includes("test-key-not-real"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(paths.auth, "utf8")), {
    auth_mode: "apikey",
    OPENAI_API_KEY: "test-key-not-real",
  });
  const match = await liveProfileMatch(paths, {
    id: "relay-b",
    kind: "api",
    providerKey: "relay-deepseek",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    runtimeMode: "direct",
  }, vaultFile);
  assert.equal(match.matches, true);
  const catalog = JSON.parse(await fs.readFile(paths.modelCatalog, "utf8"));
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].display_name, "DeepSeek R1");
  assert.equal(catalog.models[0].context_window, 131072);
  assert.match(catalog.models[0].base_instructions, /Follow the latest user message/);
  assert.equal(catalog.models[0].model_messages.instructions_template, "{{ personality }}");
});

test("GPT relay switching keeps every GPT catalog entry and excludes other vendors", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-gpt-catalog-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
  const vaultFile = path.join(home, "vault.json");
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{}\n');

  await switchProfile(paths, {
    id: "relay-gpt",
    name: "GPT relay",
    kind: "api",
    providerKey: "relay-gpt",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    model: "gpt-5.6-sol",
    runtimeMode: "direct",
    configuredModel: "gpt-5.6",
    singleModel: false,
    modelCatalog: [
      { sourceId: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
      { sourceId: "gpt-5.6-terra", display_name: "GPT-5.6 Terra" },
      { sourceId: "gpt-5.4", display_name: "GPT-5.4" },
      { sourceId: "deepseek-v3.2", display_name: "DeepSeek V3.2" },
    ],
  }, vaultFile);

  const catalog = JSON.parse(await fs.readFile(paths.modelCatalog, "utf8"));
  assert.deepEqual(catalog.models.map((model) => model.slug), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.4"]);
  assert.deepEqual(catalog.models.map((model) => model.display_name), ["GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.4"]);
  for (const model of catalog.models) {
    assert.equal(Object.hasOwn(model, "context_window"), false);
    assert.equal(Object.hasOwn(model, "max_context_window"), false);
    assert.equal(Object.hasOwn(model, "effective_context_window_percent"), false);
  }
});

test("reselecting a direct API profile replaces the legacy artificial 128K catalog", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-legacy-context-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
  const vaultFile = path.join(home, "vault.json");
  const profile = {
    id: "relay-gpt",
    name: "GPT relay",
    kind: "api",
    providerKey: "relay-gpt",
    runtimeProvider: "relay-gpt",
    runtimeMode: "direct",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    model: "gpt-5.6-sol",
  };
  await fs.writeFile(paths.config, TOML.stringify({
    model: profile.model,
    model_provider: profile.providerKey,
    model_catalog_json: paths.modelCatalog,
    cli_auth_credentials_store: "file",
    model_providers: {
      [profile.providerKey]: {
        name: profile.name,
        wire_api: "responses",
        base_url: profile.baseUrl,
        requires_openai_auth: true,
      },
    },
  }));
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"test-key-not-real"}\n');
  await fs.writeFile(paths.modelCatalog, `${JSON.stringify({
    models: [{
      slug: profile.model,
      base_instructions: `You are Codex Galaxy, powered by ${profile.model}.`,
      default_reasoning_level: "max",
      supported_reasoning_levels: [{ effort: "max", description: "Legacy unsupported effort" }],
      context_window: 128000,
      max_context_window: 128000,
      effective_context_window_percent: 95,
    }],
  }, null, 2)}\n`);

  const stale = await liveProfileMatch(paths, profile, vaultFile);
  assert.equal(stale.matches, false);
  assert.equal(stale.reason, "api-context-metadata-stale");
  assert.equal(stale.recoverableConfig, true);

  await switchProfile(paths, profile, vaultFile);

  const repairedCatalog = JSON.parse(await fs.readFile(paths.modelCatalog, "utf8"));
  assert.equal(Object.hasOwn(repairedCatalog.models[0], "context_window"), false);
  assert.equal(Object.hasOwn(repairedCatalog.models[0], "max_context_window"), false);
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);
});

test("an API profile does not match when its selected provider definition is missing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-missing-provider-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "catalog.json"),
    backupDir: path.join(home, "backups"),
  };
  const vaultFile = path.join(home, "vault.json");
  const profile = {
    id: "api-a",
    name: "API A",
    kind: "api",
    providerKey: "galaxy",
    runtimeProvider: "galaxy",
    baseUrl: "http://127.0.0.1:43821/v1",
    apiKey: "test-key-not-real",
    model: "gpt-5.6",
  };
  await fs.writeFile(paths.config, [
    'model = "gpt-5.6"',
    'model_provider = "galaxy"',
    'cli_auth_credentials_store = "file"',
    "",
    "[mcp_servers.keep]",
    'command = "keep-me"',
    "",
  ].join("\n"));
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"test-key-not-real"}\n');

  const broken = await liveProfileMatch(paths, profile, vaultFile);
  assert.equal(broken.matches, false);
  assert.equal(broken.reason, "api-provider-missing");
  assert.equal(broken.recoverableConfig, true);

  await switchProfile(paths, profile, vaultFile);
  const repaired = TOML.parse(await fs.readFile(paths.config, "utf8"));
  assert.equal(repaired.model_provider, "galaxy");
  assert.equal(repaired.model_providers.galaxy.wire_api, "responses");
  assert.equal(repaired.model_providers.galaxy.base_url, "http://127.0.0.1:43821/v1");
  assert.equal(repaired.mcp_servers.keep.command, "keep-me");
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);
});

test("official switching restores file credentials and removes stale forced-login settings", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-official-restore-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), modelCatalog: path.join(home, "catalog.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\ncli_auth_credentials_store = "keyring"\nforced_login_method = "chatgpt"\nforced_chatgpt_workspace_id = "workspace-a"\n\n[model_providers.custom]\nname = "Stale relay"\nwire_api = "responses"\nbase_url = "https://stale.invalid/v1"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"official-token"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  await fs.writeFile(paths.config, 'model_provider = "galaxy"\nmodel_context_window = 128000\nmodel_auto_compact_token_limit = 115200\nmodel_auto_compact_token_limit_scope = "total"\nforced_login_method = "apikey"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"relay-key"}\n');

  await switchProfile(paths, profile, vaultFile);

  const config = TOML.parse(await fs.readFile(paths.config, "utf8"));
  assert.equal(config.model_provider, "openai");
  assert.deepEqual(Object.keys(config.model_providers), ["openai"]);
  assert.equal(config.cli_auth_credentials_store, "file");
  assert.equal(config.model_context_window, undefined);
  assert.equal(config.model_auto_compact_token_limit, undefined);
  assert.equal(config.model_auto_compact_token_limit_scope, undefined);
  assert.equal(config.forced_login_method, undefined);
  assert.equal(config.forced_chatgpt_workspace_id, undefined);
  assert.equal(JSON.parse(await fs.readFile(paths.auth, "utf8")).auth_mode, "chatgpt");
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);
});

test("reselecting an official profile clears stale global auto-compaction overrides", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-official-context-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), modelCatalog: path.join(home, "catalog.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model = "gpt-5.6"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\nmodel_context_window = 128000\nmodel_auto_compact_token_limit = 115200\nmodel_auto_compact_token_limit_scope = "total"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"official-token"}}\n');
  await captureCurrent(paths, profile, vaultFile);

  const stale = await liveProfileMatch(paths, profile, vaultFile);
  assert.equal(stale.matches, false);
  assert.equal(stale.reason, "official-context-config-stale");

  await switchProfile(paths, profile, vaultFile);

  const repaired = TOML.parse(await fs.readFile(paths.config, "utf8"));
  assert.equal(repaired.model_context_window, undefined);
  assert.equal(repaired.model_auto_compact_token_limit, undefined);
  assert.equal(repaired.model_auto_compact_token_limit_scope, undefined);
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);
});

test("official capture rejects API auth and protects a captured account identity", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-official-capture-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{"OPENAI_API_KEY":"relay-key"}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /不是官方 ChatGPT 登录状态/);

  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"token-a"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-b","access_token":"token-b"}}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /与该槽位不一致/);
});

test("legacy official snapshots without a stored fingerprint remain valid and protected", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-legacy-official-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"token-a"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  const vault = JSON.parse(await fs.readFile(vaultFile, "utf8"));
  delete vault.profiles[profile.id].authAccountFingerprint;
  await fs.writeFile(vaultFile, `${JSON.stringify(vault, null, 2)}\n`);

  await fs.writeFile(paths.config, 'model_provider = "galaxy"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"relay-key"}\n');
  await switchProfile(paths, profile, vaultFile);
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);

  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-b","access_token":"token-b"}}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /与该槽位不一致/);
});
